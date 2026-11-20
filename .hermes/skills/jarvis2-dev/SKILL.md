---
name: jarvis2-dev
description: Develop and test Jarvis 2.0 across its three surfaces.
version: 0.1.0
author: H3man, Hermes Agent
license: MIT
platforms: [linux]
---

# Jarvis 2.0 development

Use for changes to the Omajarv `jarvis-2.0` branch. Not for maintenance of `main`/1.0 or the installed Omarchy plugin.

## Start here

1. With `terminal`, run `git status --short --branch`, `git worktree list`, and `git remote -v`. The 2.0 worktree shares the Omajarv remote with the main/1.0 worktree. Use an explicitly approved feature branch based on 2.0 for parallel changes. Never branch-switch or clean a dirty worktree to make a test pass.
2. Identify the failing surface below. Read just its entry point, contract and closest test using `read_file` and `search_files`. Trace both consumers only when changing a shared contract. Use a minimal failing test before editing and run the wider affected suite after it passes.

## Web frontend and CSS

- Start at `server/public/index.html` for stylesheet order, script loading, and mount points. `server/public/jarvis.css` is authored CSS for the base UI; `server/public/jarvis.js` is authored browser code for the voice core, transcript, and chat lifecycle. `frontend/src/dashboard.jsx` and feature JSX own React panels; `frontend/src/dashboard.css` is the Tailwind/component CSS source. Do not hand-edit generated `server/public/dashboard.css` or `dashboard.js`.
- Inspect the computed cascade and theme tokens (`/theme.css`, `/api/theme`) before overriding a selector; scope changes to the owning component. Keep touch, keyboard/focus, mobile and desktop breakpoints, live theme changes and reduced motion working. The browser's rotating marching phrases are not the Omarchy top bar.
- Run `npm run build:frontend` in `terminal` to regenerate bundles and stamp the HTML. The cache hash covers dashboard.js, dashboard.css, jarvis.js, and authored jarvis.css. Shared web scrollbars live in jarvis.css; keep intentional hidden tickers, native touch sizing and forced-colors behavior. Check two-axis overflow and live light/dark swaps. Check rendered pages at desktop and mobile sizes; start with `tests/theme-browser.mjs` and the relevant core/voice tests.

## Node API and voice

- Start with `docs/API.md`, then verify the route in `server/jarvis-server.mjs` and locate the consumer. In the browser trace `apiFetch` in `server/public/jarvis.js` and the relevant React caller. Document changed auth, payload, status codes and SSE events. Use `X-Jarvis-Token` privately for probes; never echo tokens or QR URLs. Preserve existing ingress and attachment boundaries.
- `/api/stt` accepts recording bytes and content type; `server/lib/stt.mjs` decodes via FFmpeg and runs local Whisper. `/api/chat` submits text and streams SSE; `/api/tts` produces spoken output. Diagnose capture → upload → decode → recognition → chat → playback separately. Successful synthetic audio proves the backend, not the microphone. A chat 409 after STT is not an STT failure. Dictation started in Voice auto-sends only while still in Voice; Conversation dictation appends to the editable composer without submitting. Keep both MediaRecorder and WAV fallback on the same path.
- Check `/api/history` busy and `/api/status` chatBusy/activity. A new session is not a new server lock. Keep idle Kanban polling from claiming the chat lock; coordinate real work, cancellation and release with `server/lib/kanban-runner.mjs`. Sample repeatedly when debugging intermittent busy states. Use `tests/integration.mjs`, `tests/kanban-runner.mjs` and `tests/voice-reply-release.mjs` as applicable. For PostgreSQL use isolated test state, not the active database; see `docs/CONVERSATION-STORAGE.md`.

## Omarchy top bar (native surface)

- Start at `plugin/h3man.jarvis/manifest.json`, `BarWidget.qml` for the widget and `Panel.qml` for the popup. Trace Quickshell `Process` calls and JSON to `bin/jarvis`, then the Node handler when applicable. The panel is not React and does not use the web CSS; native desktop app launch is a separate path from rendering the bar itself.
- Validate QML in the Quickshell host or a compatible harness. Verify open/close, live status, relevant CLI contract, and the changed layout/theme. Use applicable native tests such as `tests/native-calendar-smoke.mjs` and `tests/desktop-notifications.mjs`. If the host cannot run, report that explicitly; a frontend build does not validate QML.

## Persistent development conversations

- For long Jarvis development work, use `bash scripts/rex-chat.sh new` to start the `jarvis2` Hermes specialist in a separate local Rex session. Use `list`, `view SESSION`, `send SESSION TEXT`, and `stop SESSION` to reconnect to the same process, observe it, send one line, or interrupt it. Inspect `view` before sending; a terminal may be showing a confirmation or a running task. Do not put secrets in terminal input, snapshots, or command arguments.
- This is a terminal workflow, separate from the Jarvis web chat and Kanban runner. Rex keeps the PTY alive across launcher exits, not across Rex server termination or reboot. Do not mistake a running terminal for a healthy provider; inspect output before interrupting and never replay a possibly applied task automatically.

## Runtime and verification

- Use `npm run dev:status` and `scripts/dev.mjs` to identify managed 2.0. Defaults: local 4318, private dev state and Unix ingress socket. Inspect `tailscale serve status` if remote access matters; do not assume the remote port or alter Serve. Use separate dev runtime, alias and port for parallel instances. Never touch 1.0's installed service or overwrite its plugin files during 2.0 development.
- Prefer targeted `node --test tests/<relevant>.mjs`, then validate the affected client and run `git diff --check`. Use fake agents and synthetic audio unless a real user test is requested. Keep restarts separate from code verification and never interrupt an active reply or task. Report branch, affected surface, tests, and whether the running instance actually loaded the changes.
