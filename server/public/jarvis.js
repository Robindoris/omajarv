/* J.A.R.V.I.S. front-end — vanilla JS, no build step, no external dependencies. */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Small helpers                                                       */
  /* ------------------------------------------------------------------ */

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var clamp = function (n, lo, hi) { return Math.min(hi, Math.max(lo, n)); };

  var TOKEN_KEY = 'jarvis.token';
  var token = '';

  // Read the token once. Persist it so a reload without ?k= still works.
  try {
    var qToken = new URLSearchParams(window.location.search).get('k');
    if (qToken) {
      token = qToken;
      try { sessionStorage.setItem(TOKEN_KEY, qToken); } catch (e) { /* private mode */ }
    } else {
      token = sessionStorage.getItem(TOKEN_KEY) || '';
    }
  } catch (e) { token = ''; }

  function apiUrl(path) {
    if (!token) return path;
    return path + (path.indexOf('?') === -1 ? '?' : '&') + 'k=' + encodeURIComponent(token);
  }

  // CSS loads the host theme before first paint; this palette also drives canvas.
  function themeRgb(value, fallback) {
    var match = String(value || '').trim().match(/^#([a-f\d]{6}|[a-f\d]{3})$/i);
    if (!match) return fallback;
    var code = match[1];
    if (code.length === 3) code = code.split('').map(function (c) { return c + c; }).join('');
    return [0, 2, 4].map(function (i) { return parseInt(code.slice(i, i + 2), 16); });
  }
  function readVisualTheme() {
    var style = window.getComputedStyle(document.documentElement);
    var fallback = { bg: [4, 7, 10], text: [215, 247, 252], core: [111, 242, 255], mid: [43, 166, 196], dim: [14, 58, 71], bright: [215, 247, 252], amber: [255, 179, 71], red: [255, 93, 93] };
    var result = {};
    Object.keys(fallback).forEach(function (key) { result[key] = themeRgb(style.getPropertyValue('--' + key), fallback[key]); });
    return result;
  }
  var visualTheme = readVisualTheme();
  var themeRevision = '';
  var themeLoading = false;
  function mixColors(a, b, amount) {
    return a.map(function (v, i) { return Math.round(v * (1 - amount) + b[i] * amount); });
  }
  async function loadTheme() {
    if (themeLoading || document.visibilityState === 'hidden') return;
    themeLoading = true;
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 5000);
    try {
      var response = await fetch(apiUrl('/api/theme'), { cache: 'no-store', signal: ctrl.signal });
      if (!response.ok) return;
      var theme = await response.json();
      if (!theme.css || theme.revision === themeRevision) return;
      var root = document.documentElement;
      Object.keys(theme.css).forEach(function (key) {
        if (/^--[a-z-]+$/.test(key)) root.style.setProperty(key, theme.css[key]);
      });
      root.style.colorScheme = theme.mode === 'light' ? 'light' : 'dark';
      root.dataset.theme = theme.name || 'Omarchy';
      var schemeMeta = document.querySelector('meta[name="color-scheme"]');
      if (schemeMeta) schemeMeta.content = root.style.colorScheme;
      var chromeMeta = document.querySelector('meta[name="theme-color"]');
      if (chromeMeta) chromeMeta.content = theme.palette.bg;
      visualTheme = readVisualTheme();
      themeRevision = theme.revision;
    } catch (e) { /* Keep the last valid theme when the bridge is unreachable. */ }
    finally { clearTimeout(timer); themeLoading = false; }
  }
  window.setInterval(loadTheme, 5000);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') loadTheme(); });

  if (token) {
    var manifest = document.createElement('link');
    manifest.rel = 'manifest';
    manifest.href = apiUrl('/manifest.webmanifest');
    document.head.appendChild(manifest);
  }
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('/sw.js').catch(function () {});
  }

  var reducedQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  var prefersReduced = !!(reducedQuery && reducedQuery.matches);

  var el = {
    body: document.body,
    ptt: $('#ptt'),
    pttLabel: $('#pttLabel'),
    pttTimer: $('#pttTimer'),
    stopBtn: $('#stopBtn'),
    resetBtn: $('#resetBtn'),
    typeToggle: $('#typeToggle'),
    composer: $('#composer'),
    textInput: $('#textInput'),
    sendBtn: $('#sendBtn'),
    composerClose: $('#composerClose'),
    transcript: $('#transcript'),
    transcriptHint: $('#transcriptHint'),
    statusPill: $('#statusPill'),
    statusText: $('#statusText'),
    agentName: $('#agentName'),
    readoutMode: $('#readoutMode'),
    readoutMic: $('#readoutMic'),
    readoutSession: $('#readoutSession'),
    bootOverlay: $('#bootOverlay'),
    bootText: $('#bootText'),
    pttHint: $('#pttHint')
  };

  var S = {
    BOOT: 'boot',
    IDLE: 'idle',
    LISTENING: 'listening',
    TRANSCRIBING: 'transcribing',
    THINKING: 'thinking',
    SPEAKING: 'speaking',
    ERROR: 'error'
  };

  var state = S.BOOT;
  var online = null;            // null = unknown, true/false after status
  var agentName = 'CODEX';
  var limits = { maxRecordingSec: 120, maxTextChars: 4000 };
  var generation = 0;           // bumped to invalidate async work
  var statusTimer = 0;
  var errorTimer = 0;
  var bootDone = false;
  var pillOverride = '';
  var pillOverrideTimer = 0;
  var reactor = null;

  /* ------------------------------------------------------------------ */
  /* State, HUD and readouts                                             */
  /* ------------------------------------------------------------------ */

  var MODE_LABEL = {
    boot: 'STARTUP',
    idle: 'STANDBY',
    listening: 'CAPTURE',
    transcribing: 'DECODE',
    thinking: 'REASON',
    speaking: 'OUTPUT',
    error: 'FAULT'
  };

  var HINT_LABEL = {
    boot: 'INITIALIZING',
    idle: 'STANDBY',
    listening: 'MIC LIVE',
    transcribing: 'DECODING',
    thinking: 'AGENT WORKING',
    speaking: 'AUDIO OUT',
    error: 'FAULT'
  };

  function pillLabel() {
    if (pillOverride) return pillOverride;
    if (online === false) return 'OFFLINE';
    if (online === null && (state === S.BOOT || state === S.IDLE)) return 'LINKING';
    switch (state) {
      case S.BOOT: return 'BOOT';
      case S.LISTENING: return 'LISTENING';
      case S.TRANSCRIBING: return 'TRANSCRIBING';
      case S.THINKING: return 'THINKING';
      case S.SPEAKING: return 'SPEAKING';
      case S.ERROR: return 'ERROR';
      default: return 'ONLINE';
    }
  }

  function renderPill() {
    if (!el.statusPill) return;
    var visual = (online === false) ? 'offline' : state;
    el.statusPill.dataset.state = visual;
    el.statusText.textContent = pillLabel();
  }

  function pttLabelForState() {
    if (state === S.LISTENING) return latched ? 'TAP TO SEND' : 'RELEASE TO SEND';
    if (state === S.TRANSCRIBING) return 'TRANSCRIBING';
    if (state === S.THINKING) return 'THINKING';
    if (state === S.SPEAKING) return 'INTERRUPT';
    if (state === S.BOOT) return 'INITIALIZING';
    return 'HOLD TO TALK';
  }

  function renderPTT() {
    var recording = state === S.LISTENING;
    if (el.ptt) {
      el.ptt.classList.toggle('is-recording', recording);
      el.ptt.setAttribute('aria-pressed', recording ? 'true' : 'false');
      el.ptt.setAttribute('aria-label', recording
        ? 'Recording. Release or tap to send.'
        : 'Push to talk. Press and hold to record.');
    }
    if (el.pttLabel) el.pttLabel.textContent = pttLabelForState();
    if (el.pttTimer) el.pttTimer.style.visibility = recording ? 'visible' : 'hidden';
  }

  var voiceInputReady = true;
  var remoteBusy = false;
  var historySignature = "";
  var historyLoading = false;

  function renderControls() {
    var busy = state === S.LISTENING || state === S.TRANSCRIBING ||
      state === S.THINKING || state === S.SPEAKING || state === S.ERROR;
    if (el.stopBtn) {
      el.stopBtn.disabled = state === S.BOOT || (!busy && !isPlaying && !remoteBusy);
      el.stopBtn.classList.toggle('is-active', state === S.SPEAKING || state === S.THINKING);
    }
    if (el.ptt) el.ptt.disabled = state === S.BOOT || remoteBusy || !voiceInputReady;
    if (el.typeToggle) el.typeToggle.disabled = state === S.BOOT;
    if (el.resetBtn) el.resetBtn.disabled = state === S.BOOT || remoteBusy;
  }

  function setState(next) {
    if (next !== state && pillOverride) {
      pillOverride = '';
      clearTimeout(pillOverrideTimer);
    }
    state = next;
    if (el.body) el.body.dataset.state = next;
    if (el.readoutMode) el.readoutMode.textContent = MODE_LABEL[next] || next;
    if (el.transcriptHint) el.transcriptHint.textContent = HINT_LABEL[next] || '';
    renderPill();
    renderPTT();
    renderControls();
    if (reactor) reactor.setMode(next);
  }

  function flashStatus(text, ms) {
    pillOverride = text;
    renderPill();
    clearTimeout(pillOverrideTimer);
    pillOverrideTimer = setTimeout(function () {
      pillOverride = '';
      renderPill();
    }, ms || 1300);
  }

  function setAgent(name) {
    if (!name) return;
    agentName = String(name).toUpperCase().slice(0, 18);
    if (el.agentName) el.agentName.textContent = agentName;
  }

  function setSession(value) {
    if (!el.readoutSession) return;
    el.readoutSession.textContent = value || '--';
  }

  /* ------------------------------------------------------------------ */
  /* Transcript                                                          */
  /* ------------------------------------------------------------------ */

  var MAX_TRANSCRIPT_LINES = 40;

  function nearBottom() {
    var t = el.transcript;
    if (!t) return true;
    return (t.scrollHeight - t.scrollTop - t.clientHeight) < 36;
  }

  function scrollTranscript(always) {
    var t = el.transcript;
    if (!t) return;
    if (always || nearBottom()) {
      t.scrollTop = t.scrollHeight;
    }
  }

  function trimTranscript() {
    var t = el.transcript;
    if (!t) return;
    while (t.children.length > MAX_TRANSCRIPT_LINES) t.removeChild(t.firstElementChild);
  }

  // kind: 'user' | 'assistant' | 'system' | 'error'
  function addLine(kind, text, options) {
    options = options || {};
    var follow = nearBottom();
    var line = document.createElement('div');
    line.className = 'line ' + kind + (options.streaming ? ' streaming' : '');

    var role = document.createElement('span');
    role.className = 'line-role';
    role.textContent = kind === 'user' ? 'YOU' : kind === 'assistant' ? 'JARVIS' : kind === 'error' ? 'ERR' : 'SYS';

    var bodyEl = document.createElement('span');
    bodyEl.className = 'line-body';

    var textEl = document.createElement('span');
    textEl.className = 'line-text';
    textEl.textContent = text || '';

    var caret = document.createElement('span');
    caret.className = 'caret';
    caret.setAttribute('aria-hidden', 'true');

    bodyEl.appendChild(textEl);
    if (kind === 'assistant') bodyEl.appendChild(caret);
    line.appendChild(role);
    line.appendChild(bodyEl);
    el.transcript.appendChild(line);

    trimTranscript();
    if (follow) scrollTranscript(true);

    return {
      root: line,
      text: textEl,
      caret: caret,
      setText: function (value) {
        var stick = nearBottom();
        textEl.textContent = value;
        if (stick) scrollTranscript(true);
      },
      finish: function () {
        line.classList.remove('streaming');
      }
    };
  }

  function addSystem(text, kind) {
    return addLine(kind === 'error' ? 'error' : 'system', text);
  }

  /* ------------------------------------------------------------------ */
  /* Boot sequence                                                       */
  /* ------------------------------------------------------------------ */

  var bootLines = [
    'ARC REACTOR ........ ONLINE',
    'AUDIO SUBSYSTEM .... READY',
    'AGENT LINK ......... CODEX'
  ];

  function bootAgentLine(ok, name) {
    bootLines[2] = 'AGENT LINK ......... ' + (ok ? String(name || 'CODEX').toUpperCase() : 'OFFLINE');
    if (!bootDone && el.bootText) renderBootText();
  }

  var bootTyped = ['', '', ''];
  var bootTypeTimer = 0;

  function renderBootText() {
    if (!el.bootText) return;
    var joined = bootTyped.join('\n');
    if (joined && bootTyped[2].length >= bootLines[2].length) joined += '\n';
    el.bootText.textContent = joined;
  }

  function typeBoot() {
    var line = 0;
    var col = 0;
    bootTyped = ['', '', ''];
    if (prefersReduced) {
      bootTyped = bootLines.slice();
      renderBootText();
      return;
    }
    bootTypeTimer = window.setInterval(function () {
      if (bootDone) { clearInterval(bootTypeTimer); return; }
      if (line >= bootLines.length) { clearInterval(bootTypeTimer); return; }
      var target = bootLines[line];
      bootTyped[line] = target.slice(0, col + 1);
      col += 1;
      renderBootText();
      if (col >= target.length) {
        line += 1;
        col = 0;
      }
    }, 12);
  }

  function finishBoot() {
    if (bootDone) return;
    bootDone = true;
    clearInterval(bootTypeTimer);
    clearTimeout(bootTimer);
    if (el.bootOverlay) {
      el.bootOverlay.classList.add('is-done');
      window.setTimeout(function () {
        if (el.bootOverlay) el.bootOverlay.hidden = true;
      }, 500);
    }
    if (state === S.BOOT) setState(S.IDLE);
  }

  var bootTimer = window.setTimeout(finishBoot, 1200);

  /* ------------------------------------------------------------------ */
  /* Server status                                                       */
  /* ------------------------------------------------------------------ */

  function parseErrorText(text, statusCode) {
    if (!text) return 'HTTP ' + statusCode;
    try {
      var parsed = JSON.parse(text);
      return parsed.error || parsed.message || ('HTTP ' + statusCode);
    } catch (e) {
      return String(text).replace(/\s+/g, ' ').trim().slice(0, 160) || ('HTTP ' + statusCode);
    }
  }

  async function loadHistory() {
    if (historyLoading || (state !== S.IDLE && state !== S.BOOT)) return;
    historyLoading = true;
    var runId = generation;
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 6000);
    try {
      var res = await fetch(apiUrl('/api/history'), { cache: 'no-store', signal: ctrl.signal });
      if (!res.ok) return;
      var data = await res.json();
      if (runId !== generation || (state !== S.IDLE && state !== S.BOOT)) return;
      remoteBusy = data.busy === true;
      renderControls();
      if (remoteBusy) return;
      var signature = JSON.stringify([data.agent, data.messages]);
      if (signature === historySignature) return;
      historySignature = signature;
      el.transcript.innerHTML = '';
      (data.messages || []).slice(-MAX_TRANSCRIPT_LINES).forEach(function (message) {
        addLine(message.role, message.text);
      });
      if (!(data.messages || []).length) addSystem('HOLD THE CORE TO SPEAK');
      scrollTranscript(true);
    } catch (e) { /* status polling reports connection failures */ }
    finally { clearTimeout(timer); historyLoading = false; }
  }

  async function loadStatus() {
    clearTimeout(statusTimer);
    var ctrl = new AbortController();
    var timeoutId = setTimeout(function () { ctrl.abort(); }, 6000);

    try {
      var res = await fetch(apiUrl('/api/status'), { cache: 'no-store', signal: ctrl.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var data = await res.json();
      if (!data || typeof data !== 'object') throw new Error('BAD STATUS');

      online = true;
      var label = (data.agent && (data.agent.label || data.agent.id)) || 'CODEX';
      setAgent(label);
      bootAgentLine(true, agentName);
      if (data.limits && typeof data.limits === 'object') {
        if (Number(data.limits.maxRecordingSec) > 0) limits.maxRecordingSec = Number(data.limits.maxRecordingSec);
        if (Number(data.limits.maxTextChars) > 0) limits.maxTextChars = Number(data.limits.maxTextChars);
        if (el.textInput) el.textInput.maxLength = limits.maxTextChars;
      }
      if (data.session) {
        setSession(typeof data.session.turns === 'number'
          ? String(data.session.turns).padStart(2, '0') + ' TURNS'
          : (data.session.id ? String(data.session.id).slice(-4).toUpperCase() : '--'));
      }

      loadHistory();
      voiceInputReady = !!(data.stt && data.stt.ready);
      renderControls();
      var readiness = [];
      readiness.push(data.agent && data.agent.access ? data.agent.access : 'Agent defaults');
      readiness.push('STT ' + (data.stt && data.stt.ready ? 'READY' : 'OFF'));
      readiness.push('TTS ' + (data.tts && data.tts.ready ? 'READY' : 'OFF'));
      if (el.statusPill) {
        el.statusPill.title = agentName + ' · ' + readiness.join(' · ');
      }
      if (el.pttHint) el.pttHint.textContent = voiceInputReady ? 'SPACE TO TALK' : 'VOICE SETUP NEEDED · USE TEXT';

      renderPill();
      statusTimer = setTimeout(loadStatus, 15000);
    } catch (err) {
      online = false;
      bootAgentLine(false);
      if (el.statusPill) el.statusPill.title = 'Server unreachable — retrying';
      renderPill();
      if (el.pttHint) el.pttHint.textContent = 'SERVER OFFLINE';
      statusTimer = setTimeout(loadStatus, 5000);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Audio graph                                                         */
  /* ------------------------------------------------------------------ */

  var AC = null;                  // shared AudioContext
  var audioEl = null;             // single <audio> reused for TTS sentences
  var mediaSource = null;         // MediaElementAudioSourceNode
  var ttsAnalyser = null;         // analyser for spoken output
  var micSource = null;           // MediaStreamAudioSourceNode while recording
  var micAnalyser = null;
  var micSink = null;
  var micData = null;
  var ttsData = null;
  var levelValue = 0;
  var lastAmpUi = 0;
  var lastMicUi = 0;
  var audible = false;            // true while TTS audio is playing
  var audioPrimed = false;

  function ensureAudio() {
    if (!AC) {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      try { AC = new Ctx(); } catch (e) { AC = null; return null; }
    }
    if (AC.state === 'suspended') {
      try { AC.resume().catch(function () {}); } catch (e) { /* ignore */ }
    }

    if (!audioEl) {
      audioEl = new Audio();
      audioEl.preload = 'auto';
      audioEl.setAttribute('playsinline', '');
      audioEl.setAttribute('webkit-playsinline', '');
      audioEl.addEventListener('ended', onAudioEnded);
      audioEl.addEventListener('error', onAudioError);
    }

    // One MediaElementSource per element, created once. Connected through an
    // analyser so the reactor can follow playback energy.
    if (AC && audioEl && !mediaSource) {
      try {
        var Source = AC.createMediaElementSource(audioEl);
        var analyser = AC.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.78;
        Source.connect(analyser);
        analyser.connect(AC.destination);
        mediaSource = Source;
        ttsAnalyser = analyser;
        ttsData = new Uint8Array(analyser.fftSize);
      } catch (e) {
        mediaSource = null;
        ttsAnalyser = null;
      }
    }

    // Prime the graph with a silent buffer so mobile browsers unlock output.
    try {
      var buffer = AC.createBuffer(1, 1, AC.sampleRate || 22050);
      var src = AC.createBufferSource();
      src.buffer = buffer;
      src.connect(AC.destination);
      src.start(0);
    } catch (e) { /* ignore */ }

    primeAudioElement();
    return AC;
  }

  // One silent playback inside the first user gesture unlocks later async
  // TTS playback on mobile Safari/Chrome without needing another tap.
  function primeAudioElement() {
    if (audioPrimed || !audioEl || !AC) return;
    audioPrimed = true;
    var url = '';
    try {
      var silent = encodeWav(new Float32Array(800), 8000);
      url = URL.createObjectURL(silent);
      audioEl.src = url;
      var attempt = audioEl.play();
      if (attempt && typeof attempt.then === 'function') {
        attempt.then(function () {
          if (!isPlaying && speechQueue.length === 0) {
            try {
              audioEl.pause();
              audioEl.removeAttribute('src');
              audioEl.load();
            } catch (e) { /* ignore */ }
          }
          try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ }
        }).catch(function () {
          audioPrimed = false;
          try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ }
        });
      }
    } catch (e) {
      audioPrimed = false;
      if (url) { try { URL.revokeObjectURL(url); } catch (e2) { /* ignore */ } }
    }
  }

  function attachMic(stream) {
    var ctx = ensureAudio();
    if (!ctx) return;
    try {
      micSource = ctx.createMediaStreamSource(stream);
      micAnalyser = ctx.createAnalyser();
      micAnalyser.fftSize = 1024;
      micAnalyser.smoothingTimeConstant = 0.72;
      micData = new Uint8Array(micAnalyser.fftSize);
      micSink = ctx.createGain();
      micSink.gain.value = 0; // analyser needs a path to the destination; keep it silent
      micSource.connect(micAnalyser);
      micAnalyser.connect(micSink);
      micSink.connect(ctx.destination);
    } catch (e) {
      micAnalyser = null;
    }
  }

  function detachMic() {
    try { if (micSource) micSource.disconnect(); } catch (e) { /* ignore */ }
    try { if (micAnalyser) micAnalyser.disconnect(); } catch (e) { /* ignore */ }
    try { if (micSink) micSink.disconnect(); } catch (e) { /* ignore */ }
    micSource = null;
    micAnalyser = null;
    micSink = null;
    micData = null;
  }

  function rmsOf(analyser, data) {
    if (!analyser || !data) return 0;
    try {
      analyser.getByteTimeDomainData(data);
      var sum = 0;
      for (var i = 0; i < data.length; i += 2) {
        var v = (data[i] - 128) / 128;
        sum += v * v;
      }
      return Math.sqrt(sum / (data.length / 2));
    } catch (e) { return 0; }
  }

  // Called by the reactor each frame; also mirrors mic amplitude into the UI.
  function readLevel(now) {
    var target = 0;
    var raw = 0;
    if (state === S.LISTENING && micAnalyser) {
      raw = rmsOf(micAnalyser, micData);
      target = clamp(raw * 5.5, 0, 1);
    } else if (audible && ttsAnalyser) {
      raw = rmsOf(ttsAnalyser, ttsData);
      target = clamp(raw * 4.5, 0, 1);
    } else if (audible) {
      // Fake envelope when AnalyserNode could not be attached to the media element.
      target = 0.18 + 0.16 * Math.abs(Math.sin(now * 0.009)) + 0.09 * Math.abs(Math.sin(now * 0.021));
    }

    var attack = target > levelValue ? 0.42 : 0.1;
    levelValue += (target - levelValue) * attack;

    if (now - lastAmpUi > 40) {
      lastAmpUi = now;
      if (el.ptt) el.ptt.style.setProperty('--amp', levelValue.toFixed(3));
    }
    if (now - lastMicUi > 120) {
      lastMicUi = now;
      if (el.readoutMic) {
        if (state === S.LISTENING && micAnalyser) {
          var db = Math.round(20 * Math.log10(Math.max(0.0004, raw)));
          el.readoutMic.textContent = (db > -10 ? '-10' : String(Math.max(-72, db))) + ' dB';
        } else if (audible) {
          el.readoutMic.textContent = 'OUT';
        } else {
          el.readoutMic.textContent = '-- dB';
        }
      }
    }
    return levelValue;
  }

  /* ------------------------------------------------------------------ */
  /* Recording                                                           */
  /* ------------------------------------------------------------------ */

  var MIN_RECORD_MS = 350;
  var QUICK_TAP_MS = 240;
  var MIME_CANDIDATES = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus'
  ];

  var recording = false;
  var starting = false;
  var stopRequested = false;
  var pendingLatch = false;
  var latched = false;
  var rec = null;
  var timerInterval = 0;

  function pickMime() {
    if (!window.MediaRecorder) return null;
    for (var i = 0; i < MIME_CANDIDATES.length; i++) {
      try {
        if (typeof MediaRecorder.isTypeSupported !== 'function' || MediaRecorder.isTypeSupported(MIME_CANDIDATES[i])) {
          return MIME_CANDIDATES[i];
        }
      } catch (e) { /* keep looking */ }
    }
    return ''; // let the browser choose its default container
  }

  function micErrorMessage(err) {
    var name = err && err.name;
    if (name === 'NotAllowedError' || name === 'SecurityError') return 'MIC PERMISSION DENIED';
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'NO MICROPHONE FOUND';
    if (name === 'NotReadableError' || name === 'TrackStartError') return 'MIC BUSY';
    if (name === 'OverconstrainedError') return 'MIC UNSUPPORTED';
    return 'MIC ERROR' + (err && err.message ? ': ' + err.message : '');
  }

  function stopTracks(stream) {
    if (!stream) return;
    try {
      stream.getTracks().forEach(function (track) { track.stop(); });
    } catch (e) { /* ignore */ }
  }

  function startTimer() {
    clearInterval(timerInterval);
    var started = performance.now();
    timerInterval = setInterval(function () {
      if (!recording) return;
      var total = Math.max(0, Math.floor((performance.now() - started) / 1000));
      var mm = String(Math.floor(total / 60)).padStart(2, '0');
      var ss = String(total % 60).padStart(2, '0');
      if (el.pttTimer) el.pttTimer.textContent = mm + ':' + ss;
      if (limits.maxRecordingSec && total >= limits.maxRecordingSec) stopRecording();
    }, 200);
  }

  function stopTimer() {
    clearInterval(timerInterval);
    timerInterval = 0;
  }

  async function beginPTT(source) {
    ensureAudio();

    if (state === S.LISTENING) {
      if (latched) stopRecording();
      return;
    }
    if (starting || recording || state === S.BOOT) return;

    cancelRun({ keepState: true });
    starting = true;
    stopRequested = false;
    pendingLatch = false;
    latched = false;
    clearTimeout(errorTimer);

    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      starting = false;
      setState(S.IDLE);
      armError('MICROPHONE API UNAVAILABLE');
      return;
    }

    setState(S.LISTENING);
    if (el.pttTimer) el.pttTimer.textContent = '00:00';

    var stream = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      if (stopRequested && !pendingLatch) {
        stopTracks(stream);
        starting = false;
        setState(S.IDLE);
        return;
      }
      if (state !== S.LISTENING) {
        stopTracks(stream);
        starting = false;
        return;
      }

      attachMic(stream);
      if (pendingLatch) latched = true;

      var r = {
        stream: stream,
        startTs: performance.now(),
        chunks: [],
        recorder: null,
        stopWav: null,
        mime: '',
        stopRequested: false,
        gen: generation
      };

      var mime = pickMime();
      if (window.MediaRecorder && mime !== null) {
        try {
          var options = mime ? { mimeType: mime } : undefined;
          var recorder = new MediaRecorder(stream, options);
          recorder.ondataavailable = function (ev) {
            if (ev.data && ev.data.size > 0) r.chunks.push(ev.data);
          };
          recorder.onstop = function () {
            var blob = new Blob(r.chunks, { type: recorder.mimeType || r.mime || 'audio/webm' });
            detachMic();
            stopTracks(stream);
            starting = false;
            // A newer run (new recording, stop, reset) invalidates this clip.
            if (r.stopRequested || r.gen !== generation || !blob.size) {
              if (!recording && state !== S.LISTENING && state !== S.TRANSCRIBING) setState(S.IDLE);
              if (!blob.size && !r.stopRequested && r.gen === generation) armError('EMPTY RECORDING');
              return;
            }
            transcribeAudio(blob, recorder.mimeType || r.mime || 'audio/webm');
          };
          recorder.onerror = function () {
            detachMic();
            stopTracks(stream);
            starting = false;
            recording = false;
            setState(S.IDLE);
            armError('RECORDER FAILED');
          };
          r.recorder = recorder;
          r.mime = recorder.mimeType || mime || 'audio/webm';
          recorder.start(250);
        } catch (e) {
          r.recorder = null;
        }
      }

      if (!r.recorder) {
        try {
          r.stopWav = startWavCapture(stream, r);
        } catch (e) {
          detachMic();
          stopTracks(stream);
          starting = false;
          setState(S.IDLE);
          armError('AUDIO CAPTURE UNSUPPORTED');
          return;
        }
      }

      rec = r;
      recording = true;
      starting = false;
      startTimer();
      renderPTT();
      renderControls();
    } catch (err) {
      stopTracks(stream);
      detachMic();
      starting = false;
      recording = false;
      rec = null;
      setState(S.IDLE);
      armError(micErrorMessage(err));
    }
  }

  function launchPTT(source) {
    beginPTT(source).catch(function (err) {
      starting = false;
      recording = false;
      stopTimer();
      detachMic();
      setState(S.IDLE);
      armError('MIC: ' + (err && err.message ? err.message : 'FAILED'));
    });
  }

  function stopRecording() {
    if (!recording || !rec) return;

    recording = false;
    latched = false;
    pressHeld = false;
    stopTimer();
    detachMic();

    var r = rec;
    rec = null;
    var duration = performance.now() - r.startTs;
    var tooShort = duration < MIN_RECORD_MS;

    if (tooShort) {
      r.stopRequested = true;
      try { if (r.recorder && r.recorder.state !== 'inactive') r.recorder.stop(); } catch (e) { /* ignore */ }
      try { if (r.stopWav) r.stopWav(true); } catch (e) { /* ignore */ }
      stopTracks(r.stream);
      starting = false;
      setState(S.IDLE);
      addSystem('TOO SHORT — HOLD LONGER');
      flashStatus('TOO SHORT', 1300);
      renderPTT();
      return;
    }

    setState(S.TRANSCRIBING);

    if (r.recorder) {
      try {
        if (r.recorder.state !== 'inactive') r.recorder.stop();
      } catch (e) {
        stopTracks(r.stream);
        starting = false;
        setState(S.IDLE);
        armError('RECORDER STOP FAILED');
      }
    } else if (r.stopWav) {
      var blob = null;
      try {
        blob = r.stopWav(false);
      } catch (e) {
        blob = null;
      }
      stopTracks(r.stream);
      starting = false;
      if (blob && blob.size) transcribeAudio(blob, 'audio/wav');
      else { setState(S.IDLE); armError('EMPTY RECORDING'); }
    }
  }

  function abortRecording() {
    stopTimer();
    recording = false;
    starting = false;
    latched = false;
    pressHeld = false;
    detachMic();
    if (!rec) return;
    var r = rec;
    rec = null;
    r.stopRequested = true;
    try { if (r.recorder && r.recorder.state !== 'inactive') r.recorder.stop(); } catch (e) { /* ignore */ }
    try { if (r.stopWav) r.stopWav(true); } catch (e) { /* ignore */ }
    stopTracks(r.stream);
  }

  /* ------------------------------------------------------------------ */
  /* WAV fallback (AudioContext + ScriptProcessor, 16 kHz mono)          */
  /* ------------------------------------------------------------------ */

  function startWavCapture(stream, holder) {
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) throw new Error('NO AUDIO CONTEXT');
    var ctx;
    try {
      ctx = new Ctx({ sampleRate: 16000 });
    } catch (e) {
      ctx = new Ctx();
    }
    if (typeof ctx.createScriptProcessor !== 'function') {
      try { ctx.close(); } catch (e) { /* ignore */ }
      throw new Error('NO SCRIPT PROCESSOR');
    }

    var source = ctx.createMediaStreamSource(stream);
    var processor = ctx.createScriptProcessor(4096, 1, 1);
    var mute = ctx.createGain();
    mute.gain.value = 0;
    var chunks = [];
    var stopped = false;

    processor.onaudioprocess = function (event) {
      if (stopped) return;
      try {
        var input = event.inputBuffer.getChannelData(0);
        chunks.push(new Float32Array(input));
      } catch (e) { /* ignore */ }
    };

    source.connect(processor);
    processor.connect(mute);
    mute.connect(ctx.destination);
    try { ctx.resume(); } catch (e) { /* ignore */ }

    holder.wavCtx = ctx;

    return function stopWav(discard) {
      if (stopped) return null;
      stopped = true;
      processor.onaudioprocess = null;
      try { source.disconnect(); } catch (e) { /* ignore */ }
      try { processor.disconnect(); } catch (e) { /* ignore */ }
      try { mute.disconnect(); } catch (e) { /* ignore */ }
      var sampleRate = ctx.sampleRate || 16000;
      try { ctx.close(); } catch (e) { /* ignore */ }
      if (discard) return null;

      var length = 0;
      for (var i = 0; i < chunks.length; i++) length += chunks[i].length;
      if (!length) return null;
      var merged = new Float32Array(length);
      var offset = 0;
      for (var j = 0; j < chunks.length; j++) {
        merged.set(chunks[j], offset);
        offset += chunks[j].length;
      }
      var pcm16k = sampleRate === 16000 ? merged : resampleLinear(merged, sampleRate, 16000);
      return encodeWav(pcm16k, 16000);
    };
  }

  function resampleLinear(input, fromRate, toRate) {
    var ratio = fromRate / toRate;
    var outLength = Math.max(1, Math.floor(input.length / ratio));
    var out = new Float32Array(outLength);
    for (var i = 0; i < outLength; i++) {
      var pos = i * ratio;
      var idx = Math.floor(pos);
      var frac = pos - idx;
      var a = input[idx] || 0;
      var b = input[idx + 1] || a;
      out[i] = a + (b - a) * frac;
    }
    return out;
  }

  function encodeWav(samples, sampleRate) {
    var buffer = new ArrayBuffer(44 + samples.length * 2);
    var view = new DataView(buffer);
    function writeString(offset, str) {
      for (var i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    }
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, samples.length * 2, true);
    var offset = 44;
    for (var i = 0; i < samples.length; i++) {
      var s = clamp(samples[i], -1, 1);
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
    return new Blob([view], { type: 'audio/wav' });
  }

  /* ------------------------------------------------------------------ */
  /* Speech to text                                                      */
  /* ------------------------------------------------------------------ */

  async function transcribeAudio(blob, mime) {
    var runId = generation;
    setState(S.TRANSCRIBING);

    try {
      var res = await fetch(apiUrl('/api/stt'), {
        method: 'POST',
        headers: { 'Content-Type': mime || blob.type || 'application/octet-stream' },
        body: blob
      });
      var text = await res.text();
      var data = null;
      try { data = JSON.parse(text); } catch (e) { data = null; }

      if (runId !== generation) return;
      if (!res.ok || !data || data.ok === false) {
        throw new Error(parseErrorText(text, res.status));
      }

      var transcript = (data.text || '').trim();
      if (!transcript) {
        setState(S.IDLE);
        addSystem('NO SPEECH DETECTED');
        return;
      }
      if (el.transcriptHint) el.transcriptHint.textContent = 'HEARD';
      startChat(transcript);
    } catch (err) {
      if (runId !== generation) return;
      setState(S.IDLE);
      armError('STT: ' + (err && err.message ? err.message : 'FAILED'));
    }
  }

  /* ------------------------------------------------------------------ */
  /* Chat streaming (SSE parsed manually because EventSource cannot POST) */
  /* ------------------------------------------------------------------ */

  var chatAbort = null;
  var speechQueue = [];
  var currentAudioUrl = null;
  var isPlaying = false;
  var ttsOutstanding = 0;
  var ttsChain = Promise.resolve();
  var streamDone = true;
  var audioBlockedNoted = false;
  var ttsErrorNoted = false;

  // Parse an SSE response body. Returns false from onEvent to stop reading.
  async function consumeSSE(body, onEvent) {
    var reader = body.getReader();
    var decoder = new TextDecoder('utf-8');
    var buffer = '';
    var stopped = false;

    function dispatch(block) {
      if (!block) return true;
      var eventName = 'message';
      var dataLines = [];
      var lines = block.split(/\r\n|\n|\r/);
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (!line || line.charAt(0) === ':') continue;
        var colon = line.indexOf(':');
        var field = colon === -1 ? line : line.slice(0, colon);
        var value = colon === -1 ? '' : line.slice(colon + 1);
        if (value.charAt(0) === ' ') value = value.slice(1);
        if (field === 'event') eventName = value.trim();
        else if (field === 'data') dataLines.push(value);
      }
      if (!dataLines.length) return true;
      var payload = dataLines.join('\n');
      var data = payload;
      try { data = JSON.parse(payload); } catch (e) { data = { text: payload }; }
      return onEvent(eventName, data) !== false;
    }

    function drain(final) {
      // Match all SSE separators without normalizing the buffer, so a CRLF
      // split across two network chunks is still handled correctly.
      var match;
      while ((match = /\r\n\r\n|\n\n|\r\r/.exec(buffer)) !== null) {
        var block = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        if (!dispatch(block)) return false;
      }
      if (final) {
        if (buffer.trim()) {
          var last = buffer;
          buffer = '';
          if (!dispatch(last)) return false;
        }
      }
      return true;
    }

    while (!stopped) {
      var chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      stopped = !drain(false);
    }
    if (!stopped) {
      buffer += decoder.decode();
      drain(true);
    }
    try { reader.releaseLock(); } catch (e) { /* ignore */ }
  }

  function startChat(text) {
    var cleanText = String(text || '').trim();
    if (!cleanText) return;
    if (remoteBusy) { flashStatus('AGENT BUSY ON ANOTHER DEVICE', 1800); return; }

    if (recording || starting) abortRecording();
    cancelRun({ keepState: true });
    var runId = generation;
    ttsErrorNoted = false;

    addLine('user', cleanText);
    var assistant = addLine('assistant', '', { streaming: true });
    streamDone = false;
    setState(S.THINKING);

    var ctrl = new AbortController();
    chatAbort = ctrl;
    var raw = '';
    var pending = '';
    var sseError = '';
    var sawDone = false;

    function emitSentence(sentence) {
      requestSpeech(sentence, runId);
    }

    async function run() {
      try {
        var res = await fetch(apiUrl('/api/chat'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: cleanText }),
          signal: ctrl.signal
        });
        if (runId !== generation) return;
        if (!res.ok) {
          var errText = await res.text().catch(function () { return ''; });
          throw new Error(parseErrorText(errText, res.status));
        }
        if (!res.body || typeof res.body.getReader !== 'function') {
          throw new Error('STREAMING UNSUPPORTED');
        }

        await consumeSSE(res.body, function (eventName, data) {
          if (runId !== generation) return false;
          if (!data || typeof data !== 'object') data = {};

          if (eventName === 'meta') {
            if (data.agent) setAgent(data.agent);
            if (data.session) setSession(String(data.session).slice(-4).toUpperCase());
            return true;
          }
          if (eventName === 'token') {
            var delta = typeof data.text === 'string' ? data.text : '';
            if (!delta) return true;
            raw += delta;
            assistant.setText(raw);
            pending = feedSentences(pending, delta, emitSentence);
            return true;
          }
          if (eventName === 'done') {
            sawDone = true;
            if (typeof data.text === 'string' && data.text.length) {
              raw = data.text;
              assistant.setText(raw);
            }
            if (data.session) setSession(String(data.session).slice(-4).toUpperCase());
            if (pending.trim()) {
              emitSentence(pending);
              pending = '';
            }
            assistant.finish();
            streamDone = true;
            updateSpeechState();
            return true;
          }
          if (eventName === 'error') {
            sseError = data.error || 'AGENT ERROR';
            return false;
          }
          return true;
        });

        if (runId !== generation) return;
        if (sseError) throw new Error(sseError);
        if (pending.trim()) {
          emitSentence(pending);
          pending = '';
        }
        streamDone = true;
        assistant.finish();
        if (!sawDone) assistant.setText(raw);
        updateSpeechState();
      } catch (err) {
        if (err && err.name === 'AbortError') return;
        if (runId !== generation) return;
        streamDone = true;
        assistant.finish();
        var message = err && err.message ? err.message : 'FAILED';
        addSystem('CHAT: ' + message, 'error');
        if (ttsOutstanding > 0 || speechQueue.length > 0 || isPlaying) updateSpeechState();
        else armError();
      } finally {
        if (runId === generation) chatAbort = null;
      }
    }

    run().catch(function (err) {
      if (window.console && console.error) console.error('[jarvis] chat failure', err);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Sentence chunking + TTS queue                                       */
  /* ------------------------------------------------------------------ */

  var SENTENCE_DELIMS = '.!?;:\n';

  // Cut at punctuation/newline once the pending sentence is >= 20 chars.
  // Short fragments are merged forward so TTS never speaks one-word clips.
  // A hard 260-char cap prevents run-on replies without punctuation.
  function feedSentences(pending, addition, emit) {
    pending += addition;
    for (;;) {
      var cut = -1;
      for (var i = 0; i < pending.length; i++) {
        if (SENTENCE_DELIMS.indexOf(pending.charAt(i)) !== -1 && (i + 1) >= 20) {
          cut = i;
          break;
        }
      }
      if (cut >= 0) {
        var sentence = pending.slice(0, cut + 1);
        pending = pending.slice(cut + 1);
        if (sentence.trim()) emit(sentence);
        continue;
      }
      if (pending.length > 260) {
        var space = pending.lastIndexOf(' ', 210);
        if (space < 40) space = 210;
        var piece = pending.slice(0, space);
        pending = pending.slice(space);
        if (piece.trim()) emit(piece);
        continue;
      }
      break;
    }
    return pending;
  }

  function cleanForTTS(text) {
    var out = String(text || '');
    out = out.replace(/```[\s\S]*?```/g, ' ');
    out = out.replace(/`([^`]*)`/g, '$1');
    out = out.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');
    out = out.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
    out = out.replace(/https?:\/\/\S+/g, ' ');
    out = out.replace(/^\s{0,3}#{1,6}\s+/gm, '');
    out = out.replace(/[*_~#>|]+/g, ' ');
    out = out.replace(/^\s*[-+]\s+/gm, '');
    out = out.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '');
    out = out.replace(/\s+/g, ' ');
    return out.trim();
  }

  function requestSpeech(text, runId) {
    if (runId !== generation) return;
    var clean = cleanForTTS(text);
    if (!clean || clean.length < 2) return;

    ttsOutstanding += 1;
    setState(S.SPEAKING);

    ttsChain = ttsChain.then(function () {
      return synthSpeech(clean, runId);
    }).catch(function (err) {
      if (runId === generation) {
        if (!ttsErrorNoted) {
          ttsErrorNoted = true;
          addSystem('TTS: ' + (err && err.message ? err.message : 'FAILED'), 'error');
        }
        ttsOutstanding = Math.max(0, ttsOutstanding - 1);
        updateSpeechState();
      }
    });
  }

  async function synthSpeech(text, runId) {
    try {
      if (runId !== generation) return;
      var res = await fetch(apiUrl('/api/tts'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text })
      });
      if (runId !== generation) {
        try { if (res.body) res.body.cancel(); } catch (e) { /* ignore */ }
        return;
      }
      if (!res.ok) {
        var errText = await res.text().catch(function () { return ''; });
        throw new Error(parseErrorText(errText, res.status));
      }
      var blob = await res.blob();
      if (runId !== generation) return;
      if (!blob.size) throw new Error('EMPTY AUDIO');
      enqueueAudio(blob);
    } catch (err) {
      if (runId === generation) {
        if (!ttsErrorNoted) {
          ttsErrorNoted = true;
          addSystem('TTS: ' + (err && err.message ? err.message : 'FAILED'), 'error');
        }
      }
    } finally {
      if (runId === generation) {
        ttsOutstanding = Math.max(0, ttsOutstanding - 1);
        updateSpeechState();
      }
    }
  }

  function enqueueAudio(blob) {
    var url = URL.createObjectURL(blob);
    speechQueue.push(url);
    setState(S.SPEAKING);
    playNext();
  }

  async function playNext() {
    if (isPlaying) return;
    if (!speechQueue.length) {
      updateSpeechState();
      return;
    }
    if (!audioEl) ensureAudio();
    if (!audioEl) {
      var dead = speechQueue.shift();
      try { URL.revokeObjectURL(dead); } catch (e) { /* ignore */ }
      updateSpeechState();
      return;
    }

    var url = speechQueue.shift();
    currentAudioUrl = url;
    isPlaying = true;
    audible = true;

    try {
      if (AC && AC.state === 'suspended') {
        try { await AC.resume(); } catch (e) { /* ignore */ }
      }
      audioEl.src = url;
      await audioEl.play();
      setState(S.SPEAKING);
    } catch (err) {
      isPlaying = false;
      audible = false;
      cleanupAudioUrl();
      if (!audioBlockedNoted) {
        audioBlockedNoted = true;
        addSystem('AUDIO BLOCKED — TAP THE SCREEN', 'error');
      }
      speechQueue.length = 0;
      updateSpeechState();
    }
  }

  function cleanupAudioUrl() {
    if (currentAudioUrl) {
      try { URL.revokeObjectURL(currentAudioUrl); } catch (e) { /* ignore */ }
      currentAudioUrl = null;
    }
  }

  function onAudioEnded() {
    isPlaying = false;
    audible = false;
    cleanupAudioUrl();
    playNext();
  }

  function onAudioError() {
    if (!currentAudioUrl) return;
    isPlaying = false;
    audible = false;
    cleanupAudioUrl();
    playNext();
  }

  function stopAudio() {
    if (audioEl) {
      try {
        audioEl.pause();
        audioEl.removeAttribute('src');
        audioEl.load();
      } catch (e) { /* ignore */ }
    }
    isPlaying = false;
    audible = false;
    cleanupAudioUrl();
    for (var i = 0; i < speechQueue.length; i++) {
      try { URL.revokeObjectURL(speechQueue[i]); } catch (e) { /* ignore */ }
    }
    speechQueue.length = 0;
  }

  function updateSpeechState() {
    if (state === S.LISTENING || state === S.BOOT || state === S.ERROR) return;
    var busy = ttsOutstanding > 0 || speechQueue.length > 0 || isPlaying;
    if (busy) {
      if (state !== S.SPEAKING) setState(S.SPEAKING);
      return;
    }
    if (!streamDone) {
      if (state !== S.THINKING && state !== S.TRANSCRIBING) setState(S.THINKING);
      return;
    }
    if (state === S.SPEAKING || state === S.THINKING || state === S.TRANSCRIBING) setState(S.IDLE);
  }

  function cancelRun(options) {
    options = options || {};
    generation += 1;

    if (chatAbort) {
      try { chatAbort.abort(); } catch (e) { /* ignore */ }
      chatAbort = null;
    }
    streamDone = true;
    ttsOutstanding = 0;
    stopAudio();
    clearTimeout(errorTimer);

    if (!options.keepState) setState(S.IDLE);
  }

  function armError(message) {
    if (message) addSystem(message, 'error');
    setState(S.ERROR);
    clearTimeout(errorTimer);
    var myGeneration = generation;
    errorTimer = setTimeout(function () {
      if (state === S.ERROR && generation === myGeneration) setState(S.IDLE);
    }, 1900);
  }

  /* ------------------------------------------------------------------ */
  /* Push-to-talk interaction                                            */
  /* ------------------------------------------------------------------ */

  var pressHeld = false;
  var pressStart = 0;
  var pressType = 'mouse';

  function isTouchLike(type) {
    return type === 'touch' || type === 'pen';
  }

  function onPointerDown(event) {
    if (event.button !== undefined && event.button !== 0) return;
    if (state === S.BOOT) return;
    event.preventDefault();
    ensureAudio();

    if (state === S.LISTENING) {
      if (latched) stopRecording();
      else if (starting) stopRequested = true;
      return;
    }

    pressHeld = true;
    pressStart = performance.now();
    pressType = event.pointerType || 'mouse';
    try { el.ptt.setPointerCapture(event.pointerId); } catch (e) { /* ignore */ }
    launchPTT('pointer');
  }

  function onPointerUp() {
    if (!pressHeld) return;
    var held = performance.now() - pressStart;
    pressHeld = false;

    if (starting) {
      if (held < QUICK_TAP_MS && isTouchLike(pressType)) {
        pendingLatch = true;
        stopRequested = false;
      } else {
        stopRequested = true;
      }
      return;
    }
    if (!recording) return;

    // Quick touch tap latches recording; the next tap sends it.
    if (held < QUICK_TAP_MS && isTouchLike(pressType)) {
      latched = true;
      renderPTT();
      return;
    }
    stopRecording();
  }

  function onPointerCancel() {
    pressHeld = false;
    if (starting) { stopRequested = true; return; }
    if (recording) stopRecording();
  }

  function onPointerMove(event) {
    if (!pressHeld || starting || !recording || latched) return;
    var rect = el.ptt.getBoundingClientRect();
    var margin = 24;
    if (event.clientX < rect.left - margin || event.clientX > rect.right + margin ||
        event.clientY < rect.top - margin || event.clientY > rect.bottom + margin) {
      pressHeld = false;
      stopRecording();
    }
  }

  if (el.ptt) {
    el.ptt.addEventListener('pointerdown', onPointerDown);
    el.ptt.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerCancel);
  window.addEventListener('pointermove', onPointerMove, { passive: true });

  function isEditable(target) {
    if (!target) return false;
    var tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
  }

  window.addEventListener('keydown', function (event) {
    if (event.code !== 'Space' || event.repeat) return;
    if (isEditable(event.target) || state === S.BOOT) return;
    // Let native Space activation work on other buttons (reset, stop, type).
    if (event.target && event.target.tagName === 'BUTTON' && event.target !== el.ptt) return;
    event.preventDefault();
    if (state === S.LISTENING) {
      if (latched) stopRecording();
      return;
    }
    if (pressHeld) return;
    ensureAudio();
    pressHeld = true;
    pressStart = performance.now();
    pressType = 'keyboard';
    launchPTT('space');
  });

  window.addEventListener('keyup', function (event) {
    if (event.code !== 'Space') return;
    if (!pressHeld && !starting && !recording) return;
    if (isEditable(event.target)) return;
    event.preventDefault();
    pressHeld = false;
    if (starting) { stopRequested = true; return; }
    if (recording) stopRecording();
  });

  window.addEventListener('blur', function () {
    // Do not leave the microphone hot if the window loses focus mid-recording.
    if (recording) stopRecording();
  });

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'hidden') return;
    if (recording) {
      abortRecording();
      cancelRun();
      setState(S.IDLE);
    } else if (starting) {
      stopRequested = true;
    }
  });

  /* ------------------------------------------------------------------ */
  /* Buttons and text fallback                                           */
  /* ------------------------------------------------------------------ */

  function unlockAudioOnce() {
    ensureAudio();
  }
  document.addEventListener('pointerdown', unlockAudioOnce, { once: true, capture: true, passive: true });
  document.addEventListener('keydown', unlockAudioOnce, { once: true, capture: true });

  if (el.stopBtn) {
    el.stopBtn.addEventListener('click', function () {
      ensureAudio();
      abortRecording();
      cancelRun();
      setState(S.IDLE);
      fetch(apiUrl('/api/chat/stop'), { method: 'POST' }).then(loadHistory).catch(function () {});
      flashStatus('STOPPED', 900);
    });
  }

  async function resetSession() {
    abortRecording();
    cancelRun();
    ensureAudio();
    var runId = generation;
    if (el.resetBtn) el.resetBtn.disabled = true;

    try {
      var res = await fetch(apiUrl('/api/session/reset'), { method: 'POST' });
      if (!res.ok) {
        var body = await res.text().catch(function () { return ''; });
        throw new Error(parseErrorText(body, res.status));
      }
      if (runId !== generation) return;
      el.transcript.innerHTML = '';
      addSystem('SESSION CLEARED');
      setSession('--');
      setState(S.IDLE);
      flashStatus('SESSION CLEARED', 1400);
    } catch (err) {
      if (runId === generation) {
        setState(S.IDLE);
        armError('RESET FAILED: ' + (err && err.message ? err.message : 'UNKNOWN'));
      }
    } finally {
      renderControls();
    }
  }

  if (el.resetBtn) el.resetBtn.addEventListener('click', resetSession);

  function openComposer(open) {
    if (!el.composer) return;
    el.composer.hidden = !open;
    if (el.typeToggle) el.typeToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      ensureAudio();
      window.setTimeout(function () {
        if (el.textInput) el.textInput.focus();
      }, 30);
    } else if (el.textInput) {
      el.textInput.blur();
    }
  }

  if (el.typeToggle) {
    el.typeToggle.addEventListener('click', function () {
      openComposer(el.composer ? el.composer.hidden : true);
    });
  }

  if (el.composerClose) {
    el.composerClose.addEventListener('click', function () { openComposer(false); });
  }

  if (el.composer) {
    el.composer.addEventListener('submit', function (event) {
      event.preventDefault();
      if (!el.textInput) return;
      var text = el.textInput.value.trim();
      if (!text) { el.textInput.focus(); return; }
      el.textInput.value = '';
      openComposer(false);
      ensureAudio();
      startChat(text);
    });
  }

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && el.composer && !el.composer.hidden) {
      openComposer(false);
    }
  });

  function setOnline(value) {
    var changed = online !== value;
    online = value;
    if (changed) {
      renderPill();
      renderControls();
      if (value === false && el.pttHint) el.pttHint.textContent = 'SERVER OFFLINE';
      if (value && el.pttHint) el.pttHint.textContent = 'SPACE TO TALK';
    }
  }

  window.addEventListener('online', function () {
    setOnline(null);
    renderPill();
    loadStatus();
  });
  window.addEventListener('offline', function () {
    setOnline(false);
  });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && online === false) loadStatus();
  });

  window.addEventListener('unhandledrejection', function (event) {
    var reason = event.reason;
    if (reason && reason.name === 'AbortError') return;
    if (window.console && console.error) console.error('[jarvis] unhandled rejection', reason);
    addSystem('SYSTEM: ' + (reason && reason.message ? reason.message : 'UNEXPECTED ERROR'), 'error');
  });

  /* ------------------------------------------------------------------ */
  /* Arc reactor renderer                                                */
  /* ------------------------------------------------------------------ */

  function createReactor(canvas, getLevel) {
    var ctx = canvas.getContext('2d');
    if (!ctx) return { setMode: function () {}, setReduced: function () {} };

    var TAU = Math.PI * 2;
    var size = 0;
    var dpr = 1;
    var cx = 0;
    var cy = 0;
    var R = 0;
    var mode = 'boot';
    var clock = 0;
    var last = 0;
    var level = 0;
    var reduced = prefersReduced;
    var raf = 0;
    var filaments = [];
    var particles = [];
    var spawnIn = 0.4;

    function palette() {
      var base = mode === S.THINKING ? visualTheme.amber : mode === S.ERROR ? visualTheme.red : visualTheme.core;
      return {
        core: base,
        bright: mixColors(base, visualTheme.bright, 0.65),
        mid: mixColors(base, visualTheme.bg, 0.2),
        dim: mixColors(base, visualTheme.bg, 0.75)
      };
    }

    function rgba(color, alpha) {
      return 'rgba(' + color[0] + ',' + color[1] + ',' + color[2] + ',' + clamp(alpha, 0, 1).toFixed(3) + ')';
    }

    function seedParticles() {
      particles = [];
      var count = reduced ? 0 : Math.round(clamp(R / 9, 16, 30));
      for (var i = 0; i < count; i++) {
        particles.push({
          angle: Math.random() * TAU,
          radius: R * (0.34 + Math.random() * 0.6),
          speed: (0.02 + Math.random() * 0.06) * (Math.random() < 0.45 ? -1 : 1),
          size: 0.5 + Math.random() * 1.2,
          phase: Math.random() * TAU,
          wobble: 0.5 + Math.random() * 2
        });
      }
    }

    function resize() {
      var rect = canvas.getBoundingClientRect();
      var newSize = Math.max(50, Math.min(rect.width || 300, rect.height || 300));
      dpr = Math.min(2, window.devicePixelRatio || 1);
      size = newSize;
      canvas.width = Math.round(size * dpr);
      canvas.height = Math.round(size * dpr);
      cx = size / 2;
      cy = size / 2;
      R = size * 0.455;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seedParticles();
    }

    function arc(radius, start, length, width, color, alpha) {
      ctx.beginPath();
      ctx.arc(0, 0, radius, start, start + length);
      ctx.strokeStyle = rgba(color, alpha);
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.stroke();
    }

    function glowArc(radius, start, length, width, color, alpha) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      arc(radius, start, length, width * 5, color, alpha * 0.07);
      arc(radius, start, length, width * 2.4, color, alpha * 0.18);
      arc(radius, start, length, width, color, alpha);
      ctx.restore();
    }

    function draw(dt) {
      var p = palette();
      var dim = mode === S.BOOT ? 0.5 : 1;
      var pulse = 0.5 + 0.5 * Math.sin(clock * 1.55);
      var slowPulse = 0.5 + 0.5 * Math.sin(clock * 0.62 + 1.1);
      var rot = reduced ? 0 : clock;
      var lv = level * dim;
      var flicker = mode === S.ERROR ? 0.7 + 0.3 * (0.5 + 0.5 * Math.sin(clock * 19)) : 1;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.globalAlpha = flicker;

      // Ambient bloom behind the rings.
      var bloom = ctx.createRadialGradient(0, 0, R * 0.04, 0, 0, R * 1.24);
      bloom.addColorStop(0, rgba(p.mid, (0.15 + lv * 0.2 + pulse * 0.025) * dim));
      bloom.addColorStop(0.38, rgba(p.mid, (0.055 + lv * 0.06) * dim));
      bloom.addColorStop(0.72, rgba(p.dim, 0.1 * dim));
      bloom.addColorStop(1, rgba(p.dim, 0));
      ctx.fillStyle = bloom;
      ctx.fillRect(-cx, -cy, size, size);

      // Fixed outer hairline.
      arc(R * 0.975, 0, TAU, 1, p.mid, 0.13 * dim);

      // Tick collar.
      for (var i = 0; i < 96; i++) {
        var major = i % 8 === 0;
        var angle = (i / 96) * TAU + rot * 0.035;
        var r1 = R * 0.885;
        var r2 = R * (major ? 0.936 : 0.914);
        ctx.beginPath();
        ctx.moveTo(Math.cos(angle) * r1, Math.sin(angle) * r1);
        ctx.lineTo(Math.cos(angle) * r2, Math.sin(angle) * r2);
        ctx.strokeStyle = rgba(p.mid, (major ? 0.46 : 0.18) * dim);
        ctx.lineWidth = major ? 1.2 : 0.8;
        ctx.stroke();
      }

      // Outer segmented arcs, different speeds and directions.
      var outerGroups = [
        [0.18, 1.16], [1.72, 0.44], [2.5, 1.55], [4.36, 0.52], [5.24, 1.02]
      ];
      for (var g = 0; g < outerGroups.length; g++) {
        glowArc(R * 0.83, outerGroups[g][0] + rot * 0.1, outerGroups[g][1], 1.3, p.mid, 0.52 * dim);
      }

      glowArc(R * 0.718, 0.7 - rot * 0.135, 2.15, 2.2, p.core, 0.55 * dim);
      glowArc(R * 0.718, 3.55 - rot * 0.135, 1.18, 2.2, p.core, 0.4 * dim);
      glowArc(R * 0.718, 5.3 - rot * 0.135, 0.58, 1.2, p.mid, 0.5 * dim);

      // Dashed inner collar.
      for (var d = 0; d < 22; d++) {
        var da = (d / 22) * TAU - rot * 0.2;
        arc(R * 0.6, da, 0.12, 1, p.mid, (d % 5 === 0 ? 0.48 : 0.2) * dim);
      }

      // Four cardinal brackets.
      for (var b = 0; b < 4; b++) {
        var ba = b * (TAU / 4) + rot * 0.05 - Math.PI / 4;
        glowArc(R * 0.505, ba, 0.34, 1.4, p.core, 0.34 * dim);
      }

      // Fine inner tick ring, counter-rotating.
      for (var m = 0; m < 48; m++) {
        var ma = (m / 48) * TAU - rot * 0.11;
        var mr1 = R * 0.45;
        var mr2 = R * (m % 4 === 0 ? 0.478 : 0.466);
        ctx.beginPath();
        ctx.moveTo(Math.cos(ma) * mr1, Math.sin(ma) * mr1);
        ctx.lineTo(Math.cos(ma) * mr2, Math.sin(ma) * mr2);
        ctx.strokeStyle = rgba(p.mid, (m % 4 === 0 ? 0.3 : 0.12) * dim);
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }

      // Reactive waveform collar while capturing or speaking.
      if ((mode === S.LISTENING || mode === S.SPEAKING) && lv > 0.008) {
        var bars = 56;
        for (var w = 0; w < bars; w++) {
          var wa = (w / bars) * TAU + rot * 0.04;
          var wav = 0.3 + 0.7 * Math.abs(Math.sin(w * 2.31 + clock * 7.2));
          var len = R * (0.012 + lv * 0.085 * wav);
          var wr = R * 0.392;
          ctx.beginPath();
          ctx.moveTo(Math.cos(wa) * wr, Math.sin(wa) * wr);
          ctx.lineTo(Math.cos(wa) * (wr + len), Math.sin(wa) * (wr + len));
          ctx.strokeStyle = rgba(p.core, 0.16 + lv * 0.62);
          ctx.lineWidth = 1.3;
          ctx.stroke();
        }
      }

      // Thinking scanner.
      if (mode === S.THINKING) {
        glowArc(R * 0.655, rot * 1.9, 1.25, 2.2, p.core, 0.8);
        glowArc(R * 0.655, rot * 1.9 + Math.PI, 0.55, 1.2, p.mid, 0.5);
        glowArc(R * 0.34, -rot * 2.4, 0.45, 1.4, p.mid, 0.6);
      }

      // Core coil ring.
      for (var c = 0; c < 6; c++) {
        var ca = (c / 6) * TAU + rot * 0.08;
        arc(R * 0.3, ca, (TAU / 6) * 0.56, 3.2, p.mid, 0.26 * dim);
        arc(R * 0.3, ca, (TAU / 6) * 0.4, 0.9, p.core, 0.35 * dim);
      }
      arc(R * 0.245, 0, TAU, 1, p.mid, 0.16 * dim);

      // Cardinal reticle marks.
      for (var k = 0; k < 4; k++) {
        var ka = k * (TAU / 4) + Math.PI / 4;
        ctx.beginPath();
        ctx.moveTo(Math.cos(ka) * R * 0.42, Math.sin(ka) * R * 0.42);
        ctx.lineTo(Math.cos(ka) * R * 0.448, Math.sin(ka) * R * 0.448);
        ctx.strokeStyle = rgba(p.mid, 0.5 * dim);
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = rgba(p.core, 0.42 * dim);
        ctx.fillRect(Math.cos(ka) * R * 0.462 - 1, Math.sin(ka) * R * 0.462 - 1, 2, 2);
      }

      // Hot core.
      var coreR = R * (0.148 + Math.min(0.05, lv * 0.05) + pulse * 0.007);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      var coreGlow = ctx.createRadialGradient(0, 0, 0, 0, 0, coreR * 3.4);
      coreGlow.addColorStop(0, rgba(visualTheme.bright, 0.96));
      coreGlow.addColorStop(0.16, rgba(p.core, 0.9));
      coreGlow.addColorStop(0.42, rgba(p.mid, 0.34 + lv * 0.12));
      coreGlow.addColorStop(1, rgba(p.mid, 0));
      ctx.fillStyle = coreGlow;
      ctx.beginPath();
      ctx.arc(0, 0, coreR * 3.4, 0, TAU);
      ctx.fill();

      ctx.beginPath();
      ctx.arc(0, 0, coreR, 0, TAU);
      ctx.strokeStyle = rgba(p.bright, 0.9);
      ctx.lineWidth = 1.4;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(0, 0, coreR * 0.72, 0, TAU);
      ctx.strokeStyle = rgba(p.core, 0.55);
      ctx.lineWidth = 0.8;
      ctx.stroke();
      ctx.restore();

      // Slowly rotating triangle inside the core.
      ctx.beginPath();
      for (var t = 0; t < 3; t++) {
        var ta = -Math.PI / 2 + t * (TAU / 3) + rot * 0.14;
        var tx = Math.cos(ta) * coreR * 1.22;
        var ty = Math.sin(ta) * coreR * 1.22;
        if (t === 0) ctx.moveTo(tx, ty);
        else ctx.lineTo(tx, ty);
      }
      ctx.closePath();
      ctx.strokeStyle = rgba(p.bright, 0.68);
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(0, 0, coreR * 0.26, 0, TAU);
      ctx.fillStyle = rgba(visualTheme.bright, 0.9);
      ctx.fill();

      // Energy filaments arcing from the core to the outer rings.
      if (!reduced) {
        spawnIn -= dt;
        if (spawnIn <= 0) {
          spawnIn = 0.3 + Math.random() * 0.5 - lv * 0.18;
          if (filaments.length < 8) {
            filaments.push({
              angle: Math.random() * TAU,
              outer: 0.58 + Math.random() * 0.33,
              bend: (Math.random() - 0.5) * 0.18,
              width: 0.6 + Math.random() * 1.1,
              life: 0,
              max: 0.35 + Math.random() * 0.75,
              spin: (Math.random() - 0.5) * 0.4
            });
          }
        }
        for (var f = filaments.length - 1; f >= 0; f--) {
          var fil = filaments[f];
          fil.life += dt;
          if (fil.life >= fil.max) {
            filaments.splice(f, 1);
            continue;
          }
          var progress = fil.life / fil.max;
          var fade = Math.sin(Math.PI * progress);
          var fa = fil.angle + clock * fil.spin;
          var rr1 = R * 0.31;
          var rr2 = R * fil.outer;
          var x1 = Math.cos(fa) * rr1;
          var y1 = Math.sin(fa) * rr1;
          var x2 = Math.cos(fa) * rr2;
          var y2 = Math.sin(fa) * rr2;
          var bend = fil.bend * R;
          var mx = (x1 + x2) / 2 + Math.cos(fa + Math.PI / 2) * bend;
          var my = (y1 + y2) / 2 + Math.sin(fa + Math.PI / 2) * bend;
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.quadraticCurveTo(mx, my, x2, y2);
          ctx.strokeStyle = rgba(p.core, fade * (0.12 + lv * 0.45));
          ctx.lineWidth = fil.width;
          ctx.stroke();
          ctx.restore();
        }

        // Orbiting dust motes around the rings.
        for (var pi = 0; pi < particles.length; pi++) {
          var par = particles[pi];
          par.angle += par.speed * dt;
          var pr = par.radius + Math.sin(clock * par.wobble + par.phase) * R * 0.015;
          var pa = par.angle;
          var twinkle = 0.22 + 0.5 * Math.abs(Math.sin(clock * 1.4 + par.phase));
          ctx.beginPath();
          ctx.arc(Math.cos(pa) * pr, Math.sin(pa) * pr, par.size, 0, TAU);
          ctx.fillStyle = rgba(p.core, twinkle * (0.2 + lv * 0.4));
          ctx.fill();
        }
      }

      // Discrete calibration labels.
      ctx.font = Math.max(6, Math.round(R * 0.035)) + 'px ' + 'ui-monospace, Menlo, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = rgba(p.mid, 0.25 * dim);
      var tags = ['A1', 'B2', 'C3', 'D4'];
      for (var q = 0; q < 4; q++) {
        var qa = q * (TAU / 4) + rot * 0.02 - Math.PI / 2;
        ctx.fillText(tags[q], Math.cos(qa) * R * 0.56, Math.sin(qa) * R * 0.56);
      }

      ctx.globalAlpha = 1;
      ctx.restore();
    }

    function frame(ts) {
      if (!last) last = ts;
      var dt = Math.min(0.05, Math.max(0, (ts - last) / 1000));
      last = ts;
      if (!reduced) clock += dt;
      var target = getLevel(ts) || 0;
      level += (target - level) * (target > level ? 0.4 : 0.1);
      draw(dt);
      raf = requestAnimationFrame(frame);
    }

    resize();
    if (typeof ResizeObserver === 'function') {
      try {
        var observer = new ResizeObserver(function () { resize(); });
        observer.observe(canvas);
      } catch (e) { /* ignore */ }
    }
    window.addEventListener('resize', resize, { passive: true });
    raf = requestAnimationFrame(frame);

    return {
      setMode: function (next) {
        mode = next;
      },
      setReduced: function (value) {
        reduced = !!value;
        seedParticles();
        last = 0;
      }
    };
  }

  /* ------------------------------------------------------------------ */
  /* Starfield / dust                                                    */
  /* ------------------------------------------------------------------ */

  function createDust(canvas) {
    var ctx = canvas.getContext('2d');
    if (!ctx) return { setReduced: function () {} };
    var dpr = 1;
    var W = 0;
    var H = 0;
    var stars = [];
    var raf = 0;
    var last = 0;
    var reduced = prefersReduced;

    function seed() {
      var count = Math.round(clamp((W * H) / 24000, 30, 120));
      stars = [];
      for (var i = 0; i < count; i++) {
        var big = Math.random() < 0.12;
        stars.push({
          x: Math.random() * W,
          y: Math.random() * H,
          r: big ? 0.9 + Math.random() * 0.9 : 0.35 + Math.random() * 0.55,
          vx: (Math.random() - 0.5) * 0.006,
          vy: 0.002 + Math.random() * 0.009,
          phase: Math.random() * Math.PI * 2,
          twinkle: 0.2 + Math.random() * 0.6,
          white: Math.random() < 0.35
        });
      }
    }

    function resize() {
      W = window.innerWidth;
      H = window.innerHeight;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
      if (reduced) draw(0, 0);
    }

    function draw(ts, dt) {
      ctx.clearRect(0, 0, W, H);
      for (var i = 0; i < stars.length; i++) {
        var s = stars[i];
        if (!reduced) {
          s.x += s.vx * dt;
          s.y += s.vy * dt;
          if (s.y > H + 2) { s.y = -2; s.x = Math.random() * W; }
          if (s.x < -2) s.x = W + 2;
          if (s.x > W + 2) s.x = -2;
        }
        var alpha = reduced ? 0.22 : (0.1 + s.twinkle * (0.3 + 0.3 * Math.sin(ts * 0.0014 + s.phase)));
        var dustColor = s.white ? visualTheme.text : visualTheme.core;
        ctx.fillStyle = 'rgba(' + dustColor.join(',') + ',' + alpha.toFixed(3) + ')';
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    function frame(ts) {
      if (!last) last = ts;
      var dt = Math.min(50, ts - last);
      last = ts;
      draw(ts, dt);
      raf = requestAnimationFrame(frame);
    }

    resize();
    window.addEventListener('resize', resize, { passive: true });
    if (!reduced) raf = requestAnimationFrame(frame);

    return {
      setReduced: function (value) {
        reduced = !!value;
        if (reduced) {
          cancelAnimationFrame(raf);
          raf = 0;
          draw(0, 0);
        } else if (!raf) {
          last = 0;
          raf = requestAnimationFrame(frame);
        }
      }
    };
  }

  /* ------------------------------------------------------------------ */
  /* Boot / init                                                         */
  /* ------------------------------------------------------------------ */

  var reactorCanvas = $('#reactor');
  var dustCanvas = $('#dust');
  reactor = reactorCanvas ? createReactor(reactorCanvas, readLevel) : null;
  var dust = dustCanvas ? createDust(dustCanvas) : null;

  function applyReducedMotion(value) {
    prefersReduced = !!value;
    if (reactor) reactor.setReduced(prefersReduced);
    if (dust) dust.setReduced(prefersReduced);
  }

  if (reducedQuery) {
    var onMotionChange = function (event) { applyReducedMotion(event.matches); };
    if (typeof reducedQuery.addEventListener === 'function') {
      reducedQuery.addEventListener('change', onMotionChange);
    } else if (typeof reducedQuery.addListener === 'function') {
      reducedQuery.addListener(onMotionChange);
    }
  }

  // Double-tap zoom would fight the push-to-talk gesture on phones.
  document.addEventListener('dblclick', function (event) {
    if (event.target === el.ptt) event.preventDefault();
  }, { passive: false });

  setAgent(agentName);
  el.body.dataset.state = S.BOOT;
  setState(S.BOOT);
  addSystem('HOLD THE CORE TO SPEAK');
  renderPill();
  renderPTT();
  renderControls();
  typeBoot();
  loadStatus();
  loadTheme();
  window.setInterval(function () { if (document.visibilityState !== 'hidden') loadHistory(); }, 2500);

  // Keep the interface usable after orientation changes.
  window.addEventListener('orientationchange', function () {
    window.setTimeout(function () {
      if (reactor) reactor.setMode(state);
    }, 250);
  });

})();
