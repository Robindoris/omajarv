# JARVIS LAN API contract

The server listens on `127.0.0.1:4317` by default (LAN binding is opt-in) over **HTTPS** (self-signed, required so the
phone browser grants microphone access). Every request carries `?k=<token>` or
the `X-Jarvis-Token` header. The phone opens the explicit QR access link. Bare hostnames do not disclose the access token.

## `GET /api/status`

```json
{
  "ok": true,
  "version": "1.0.0",
  "host": "192.0.2.10",
  "port": 4317,
  "url": "https://random-words.trycloudflare.com/?k=…",
  "lanUrl": "https://192.0.2.10:4317/?k=…",
  "qrTarget": "tunnel",
  "tunnel": { "enabled": true, "provider": "cloudflare", "state": "up",
              "url": "https://random-words.trycloudflare.com", "restarts": 0 },
  "agent": { "id": "codex", "label": "Codex", "ready": true },
  "stt": { "ready": true, "model": "base.en", "engine": "whisper-cli" },
  "tts": { "ready": true, "voice": "en_US-lessac-medium" },
  "session": { "id": "…", "turns": 3 },
  "limits": { "maxRecordingSec": 120, "maxTextChars": 4000 }
}
```

`tunnel.state` is `off | starting | up | error`. The hostname is generated per
cloudflared process, so it changes on every server restart.

## Phone sudo authorization

`GET /api/sudo/pending` returns `{ "requests": [...] }` containing the current
turn's request ID, command, working directory, sudo prompt, expiry timestamp and SPKI PEM RSA
public key. `POST /api/sudo/reply` accepts `{ "id": "…", "ciphertext": "…" }`
or `{ "id": "…", "cancel": true }`. Encrypt UTF-8 password bytes with
RSA-3072 OAEP using SHA-256 and send the 384-byte result as standard base64. Never
send a plaintext password field. Replies are one-use; stale or invalid responses
return 409. These endpoints require the normal access token, are uncached, and
are unavailable in development HTTP mode (403). POST requires JSON and rejects
cross-site browser submissions. Passwords are limited to 256 UTF-8 bytes without
line breaks or NUL. Requests expire after 120 seconds and are cancelled by Stop
or turn completion. No HTTP response returns a password or private key.

## `GET /api/personality` and `POST /api/personality`

Both endpoints require the normal bearer credential. GET returns `assistantName`,
`personality`, `userName`, `revision`, and `stage` (`pendingSetup`, `assistantName`,
`personality`, `userName`, or `complete`). POST accepts the three editable strings
and the current `revision`. Names must contain 1–80 characters and personality
1–8000 characters. Saving completes personalization and clears remembered agent
sessions while retaining the shared transcript. A stale revision or active chat
returns 409; invalid fields return 400. No other configuration fields are editable
through this endpoint.

The personality state may also contain a private `hiddenInstructions` string. It
is appended to the agent prompt but is never returned by these endpoints or shown
in the personality editor; it is maintained outside the frontend.

`GET /api/history` includes names, stage and revision as `profile` (without the
personality prompt), along with the shared
personalization exchange. During personalization, `POST /api/chat` must include
the current `profileRevision`. Each answer advances one step and returns ordinary
`token` and `done` SSE events, with the updated `profile` in `done`. These steps
run locally without invoking an agent. The `done.profile` object also omits the
prompt. Conversation reset preserves personality. Agent errors contain
application-authored messages, not raw provider/tool stderr.

## `GET /api/models` and `POST /api/agent/model`

Both endpoints require the normal bearer token. They let the user pick which
model the coding agent uses. Only model identifiers travel across the API —
never provider keys.

`GET /api/models` maps over the active agent:

```json
{ "ok": true, "agent": "opencode", "listed": true, "models": [
  { "id": "opencode/glm-5.3-flash-free", "free": true, "selected": false },
  { "id": "openai/gpt-5.6-cyber", "free": false, "selected": true }
], "note": "" }
```

OpenCode lists its models via `opencode models` (cached 15 minutes), free ids
first. Hermes does not expose a scriptable list (`listed: false` plus a `note`
pointing at `hermes model`). Agents without model choice return `listed: false`
and no note.

`POST /api/agent/model` takes `{ "model": "provider/model" }` — or
`{ "model": "" }` to return the agent to its own default. An empty model pins
nothing; the agent's provider default stays in control. The chosen id must be in
the current listing (400 otherwise); invalid requests return 400 and an active
chat returns 409. The choice is stored per agent (config `agentModels`), applies
to the next request (`--model` for OpenCode), and is reflected in `agent.model`
plus `agent.modelSelectable` in `GET /api/status`. The response is the refreshed
`GET /api/models` payload.

## `GET /api/voice-settings` and `POST /api/voice-settings`

Authenticated and uncached. GET and successful POST return exactly these three
sections (example paths are illustrative; discovery returns local installed files):

```json
{
  "settings": {
    "stt": { "engine": "auto", "model": "base.en", "modelPath": "", "language": "en", "serverPort": 8178 },
    "tts": { "voice": "en_US-ljspeech-medium", "modelPath": "", "speed": 1 },
    "maxRecordingSec": 120
  },
  "models": {
    "whisper": [{ "name": "base.en", "path": "/example/models/ggml-base.en.bin" }],
    "piper": [{ "name": "en_US-ljspeech-medium", "path": "/example/models/en_US-ljspeech-medium.onnx" }]
  },
  "status": {
    "stt": { "ready": true, "model": "base.en", "engine": "whisper-cli", "modelPath": "/example/models/ggml-base.en.bin" },
    "tts": { "ready": true, "voice": "en_US-ljspeech-medium", "engine": "piper", "modelPath": "/example/models/en_US-ljspeech-medium.onnx" }
  }
}
```

POST accepts `{ "settings": { ... } }` or a direct settings object; either may
contain a partial update of the editable fields shown above. Unknown fields,
invalid types, malformed JSON, non-JSON content types and cross-site browser
submissions return HTTP 400 with `{ "error": "..." }`. Empty settings objects are
rejected. POST requires `Content-Type: application/json`.

Validation:

- `stt.engine`: `auto | cli | server`. **All currently use local whisper-cli**;
  `server` and `serverPort` are retained compatibility settings, not permission
  to start or contact an unauthenticated Whisper HTTP listener. Consult
  `status.stt.engine` for the actual runtime, including `missing`.
- `stt.model` and `tts.voice`: 1–100 ASCII letters, digits, `_`, `.`, `-`,
  starting with a letter/digit, with no `..`.
- `stt.language`: a supported lowercase Whisper language code (for example `en`,
  `sk`, `de`, `zh`) or `auto`.
- `stt.serverPort`: integer 1–65535.
- `stt.modelPath` and `tts.modelPath`: empty, or a local absolute/`~/` path of
  at most 4096 characters with no control characters. Explicit paths must name
  an existing nonempty `.bin` Whisper model or `.onnx` Piper model; Piper also
  requires a nonempty matching `.onnx.json` file. Paths are reused in place.
- `maxRecordingSec`: integer 1–600 seconds. `tts.speed`: number 0.5–2 inclusive.

Discovery uses the configured paths and bounded existing common model folders;
Piper discoveries require the matching JSON file. Choosing a discovery should
send both its `name` and `path` as the model/voice and modelPath. An empty
modelPath uses the conventional JARVIS model directory with the selected name.
A name without an installed model may be saved; status reports readiness and
text chat remains available. No endpoint here downloads, installs or copies models.

The server validates the whole patch before writing a private atomic config file,
preserves unrelated settings, then applies it to subsequent requests without a
restart. STT changes invalidate any Whisper worker; TTS-only changes do not.
An active chat or STT/TTS request (including an uploading recording) returns 409;
retry after stopping/waiting. Persistence failures also return a sanitized 409
and leave runtime unchanged. Responses expose only voice configuration, model
paths and speech statuses, never the full config, tokens or provider credentials.

## `POST /api/stt`

Raw audio body (`Content-Type: audio/webm`, `audio/ogg`, `audio/wav` or
`audio/mp4`). Server converts to 16 kHz mono WAV and transcribes locally.

```json
{ "ok": true, "text": "what is on my calendar", "ms": 812, "language": "en" }
```

Errors: `{ "ok": false, "error": "…" }` with 4xx/5xx.

## `POST /api/chat`

Body: `{ "text": "…", "reset": false }`. Response is **`text/event-stream`**:

```
event: meta
data: {"agent":"codex","session":"…"}

event: token
data: {"text":"Opening"}

event: token
data: {"text":" the pod bay doors."}

event: done
data: {"text":"…full reply…","ms":4210,"session":"…"}
```

On failure: `event: error` + `data: {"error":"…"}` then the stream closes.
The client should render `token` deltas and speak on sentence boundaries as
tokens arrive.

## `POST /api/tts`

Body: `{ "text": "…" }` → `200` with `audio/wav` (`audio/wave`, 22.05 kHz mono).
Non-2xx returns JSON `{ "ok": false, "error": "…" }`.

## `POST /api/session/reset`

Archives the current transcript and clears active agent sessions for the next
`/api/chat`. Saved conversations remain available. Returns `{ "ok": true }`.

## `GET /api/conversations`

Authenticated. Returns `{conversations:[{id,agent,title,at,count,active?}]}` across
stored agents and archived chats. Add `?id=...` to retrieve a single conversation
including its `messages`. Existing history is retained; messages discarded by
older versions cannot be recovered.

## `GET /`

Without a valid token the server returns a 401 landing page on every network path. It never redirects anonymous clients to an access token.

## `GET /api/health`

Cheap liveness probe used by the Omarchy bar plugin: `{ "ok": true }`.

### Attachments

Authenticated `POST /api/attachments?name=<encoded filename>` accepts raw bytes
(up to 10 MiB), returning `{id,name,size,type}` without a local path. At most two
uploads are buffered concurrently. `POST /api/attachments/remove` accepts `{id}`
for an unsent upload. `POST /api/chat` accepts optional `attachments: [id, ...]`
(up to four distinct IDs); text may be empty when files are attached. Unknown or
expired IDs are rejected. Files are never served through an HTTP download route.
New conversation clears files; temporary uploads also expire or clear on restart.

## Voice model setup

Authenticated `GET /api/voice-setup` returns `job` (`idle`, `downloading`, `complete`,
`error`), byte counts, the current filename, missing model families, fixed download
metadata, and local runtime readiness. Reads never initiate network downloads.
Same-site JSON `POST /api/voice-setup` accepts only `{ "consent": true }`, starts a
background job, and returns HTTP 202. Concurrent setup or active speech/chat returns
409. Only the pinned catalog from `server/setup.mjs` is downloadable. Existing models
are reused. Poll GET for progress and completion; failed jobs may be retried.

## Kanban board, execution and recovery

`GET /api/kanban` returns `revision`, `tasks`, `hostDate` (host-local YYYY-MM-DD)
and `timeZone`. Existing `todo`, `doing`, `done` values map to Next up, In progress,
Done. Each task also has notes (8,000 characters), priority (low/normal/high/urgent),
a date-only dueDate, recurrence `{frequency: none|daily|weekly|monthly, interval}`,
and execution (`idle`, `queued`, `running`, `completed`, `failed`, `interrupted`).

Authenticated same-site JSON `POST /api/kanban` mutations require the current
revision. A client-generated `requestId` makes a retried request idempotent across
server restarts (the latest 100 request IDs are retained). Reusing an ID for a
changed payload returns 409. Actions: create, edit, move, delete, queue, cancel,
restore, advance. Queue creates a unique run ID. Queued/running tasks cannot be
edited, moved, deleted or queued twice. `advance` completes the specified task and
queues the first idle task in Next up, if present.

`POST /api/kanban/stop` with `{id}` aborts the actual running agent. A stopped run
becomes Interrupted only after the adapter releases it. Board execution shares the
chat/speech lock, agent session and authenticated bridge history. A successful agent
turn marks its task Done; failures remain actionable and are never automatically
retried. Restarted queued/running work becomes Interrupted for review. The runner
starts explicitly queued tasks, not every task merely sitting in Next up.

Completing a recurring task creates one next occurrence in Next up. Calendar
arithmetic uses host-local dates (month ends are clamped); repeating the same
completion cannot duplicate an occurrence. Priorities and recurrence are copied,
execution/errors/attempts are reset. Model/tool side effects themselves cannot be
rolled back by restoring a board backup.

`GET /api/kanban/backup` exports a coherent `{format:"jarvis-kanban",version:1,
createdAt,revision,tasks}` snapshot. `GET /api/kanban/backups` lists the latest 20
private pre-change snapshots; add `?revision=N` to the backup endpoint to fetch one.
Restore is a normal revision-checked mutation with `action:"restore", backup,
confirm:true`. It saves the current board first, validates the complete import,
increments the live revision, and converts imported unfinished work to Interrupted.
Active/queued work must be stopped before restore. Imports are limited to 8 MiB and
200 tasks. Exported files contain titles/notes; they contain no bridge credentials.


## Optional IP camera bridge

All camera routes require the normal bridge authentication header. Camera credentials
are accepted only in same-site JSON and stored using the private atomic config writer.
They are never returned by settings/status, embedded in browser media URLs, or included
in errors. GET `/api/ip-camera` returns `{configured,enabled,source,active}` only.
POST `/api/ip-camera` accepts `{url?,enabled?,source?,forget?}`. `source` is `device`
or `camera`; an empty URL preserves the saved value and `{forget:true}` removes it
and restores the device microphone. Settings cannot change while streams are active.

GET `/api/ip-camera/video` produces concatenated JPEG frames (640px wide, 8fps);
GET `/api/ip-camera/audio` produces little-endian signed 16-bit mono PCM at 48kHz.
Use authenticated streaming fetch, never a credential-bearing image/audio URL.
The browser JPEG parser and Web Audio bridge consume these formats. Video previews
are not sent to an agent; only explicit push-to-talk recordings follow the existing
speech-to-text flow. Tests are local preview/listening, not transcription requests.

Only RTSP with literal RFC1918 LAN IPv4 addresses is supported in this version.
Enable RTSP/audio in the camera first. Hostnames, public addresses, loopback,
HTTP/MJPEG-only cameras and cloud-only cameras are not supported. FFmpeg is required;
no model or package downloads occur when opening camera settings. RTSP uses TCP
and an eight-second network timeout. Missing credentials, audio/video tracks or
FFmpeg produce a sanitized stream error. Streams have a 12-second startup deadline,
a three-process global cap and fixed lifetimes (video: 60 seconds; audio: recording
limit plus 10 seconds, bounded to 30–610 seconds). Disconnect/shutdown sends SIGTERM
and escalates to SIGKILL after one second if needed. No recordings are saved by the
camera bridge. The browser stops preview tests after 30 seconds/video or 10 seconds/audio,
and cleans up fetches, audio contexts and image URLs when leaving Settings.

Verification: `node tests/ip-camera.mjs`, `node tests/camera-media.mjs`,
`node tests/voice-settings.mjs`, `npm run build:frontend` and
`node tests/theme-browser.mjs` cover synthetic streams and isolated runtime state.
Browser checks include save/forget, JPEG preview, audio playback, camera-only
push-to-talk, cancellation, disconnection and stream-test failure recovery at
1280px, 390px and 320px. Cancelled/disconnected recordings are never uploaded.
A real camera still needs its own address/credentials and both stream test buttons.
