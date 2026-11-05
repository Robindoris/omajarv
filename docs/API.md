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
