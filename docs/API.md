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
  "stt": { "ready": true, "model": "base.en", "engine": "whisper-server" },
  "tts": { "ready": true, "voice": "en_US-lessac-medium" },
  "session": { "id": "…", "turns": 3 },
  "limits": { "maxRecordingSec": 120, "maxTextChars": 4000 }
}
```

`tunnel.state` is `off | starting | up | error`. The hostname is generated per
cloudflared process, so it changes on every server restart.

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

Clears the agent conversation for the next `/api/chat`. Returns `{ "ok": true }`.

## `GET /`

Without a valid token the server returns a 401 landing page on every network path. It never redirects anonymous clients to an access token.

## `GET /api/health`

Cheap liveness probe used by the Omarchy bar plugin: `{ "ok": true }`.
