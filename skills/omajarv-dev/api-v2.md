# JARVIS 2.0 API implementation guide

Use with [dashboard-v2.md](dashboard-v2.md). These routes are implemented in the
chosen checkout's `server/jarvis-server.mjs`; `docs/API.md` gives full examples.
Treat handlers and owning modules as the source of truth when they differ from a
guide. Keep shared native/browser behavior in one bridge.

## Common transport and extension pattern

All `/api/*` routes require the bridge credential, including health, theme and
backups. Browser API calls use `window.jarvisAPI(path,options)`, which puts the token
in `X-Jarvis-Token`, disables caching, and attaches HTTP status to thrown errors.
Do not put tokens in ordinary API query strings. Initial access links/manifest
start_url carry credentials by design and must stay private. Responses expose only
the fields needed for that feature, never the full config or provider credentials.

New mutations should use same-site JSON, a bounded body, complete validation before
persistence, private atomic writes through `writePrivateFile`, and sanitized errors.
Do not add a permissive anonymous route or disable verification to make dev work.
Use existing busy locks for configuration/execution; do not fork another agent or
chat backend. Return an actionable 4xx conflict/validation error; do not leak raw
provider/tool diagnostics. Add route coverage for auth, valid work, invalid input,
conflicts and the new behavior, with fake agents/downloads.

The private Unix socket serves the same authenticated handler. Local board tools
connect there; native desktop's existing HTTPS transport stays verified. Explicit
`--http` development mode does not support encrypted phone sudo (403), even when
Tailscale terminates external HTTPS. Do not change that boundary incidentally.

## Complete route inventory

| Method and route | Contract / owner |
| --- | --- |
| GET `/api/health` | `{ok:true}`; authenticated liveness |
| GET `/api/status` | agent/speech readiness, session/limits, private connection information; avoid logging payload |
| GET `/api/theme` | `{name,mode,palette,css,revision}`; `lib/theme.mjs` |
| GET `/api/history` | active agent's messages, `busy`, profile summary; `lib/history.mjs` |
| GET `/api/conversations` | metadata list across active agents/archives; `?id=...` returns one conversation with messages |
| POST `/api/session/reset` | archive active transcripts, clear active agent sessions/uploads; preserve personality and saved chats; busy -> 409 |
| POST `/api/chat` | `{text,attachments?,profileRevision?,reset?}` -> SSE `meta`, `token`, `done`, `error`; shared single-agent lock |
| POST `/api/chat/stop` | abort active agent request, including a board run; no duplicate agent turn |
| GET/POST `/api/personality` | profile and revision-checked names/prompt patch; `lib/personality.mjs`; saving resets remembered agent sessions |
| GET `/api/models` | active agent model listing/capability metadata; `lib/agent-models.mjs` |
| POST `/api/agent/model` | `{model:"provider/model"}` or empty default; validate real listing and respect active chat |
| POST `/api/attachments?name=...` | raw file bytes -> `{id,name,size,type}`; private storage, 10 MiB/file, four/chat, two concurrent uploads |
| POST `/api/attachments/remove` | `{id}` removes an unsent upload; in-use file -> 409; no HTTP file-download route |
| POST `/api/stt` | raw supported audio -> local transcription `{ok,text,ms,language}` |
| POST `/api/tts` | `{text}` -> WAV; local Piper |
| GET/POST `/api/voice-settings` | editable voice settings/discovered local models/readiness; see below |
| GET/POST `/api/voice-setup` | explicit pinned model-install job/readiness/progress; see below |
| GET/POST `/api/kanban` | board view and revision-checked mutations; see below |
| GET `/api/kanban/backup` | consistent board snapshot; `?revision=N` fetches a saved snapshot |
| GET `/api/kanban/backups` | latest 20 private pre-change snapshot metadata entries |
| POST `/api/kanban/stop` | `{id}` aborts that actual running task; releases before retry |
| GET `/api/sudo/pending` | current turn's one-use encrypted approval requests; HTTPS-backed bridge only |
| POST `/api/sudo/reply` | `{id,ciphertext}` or `{id,cancel:true}`; see voice-security.md; never a password field |

Public assets: `/theme.css` for first paint, PNG install icons and `/favicon.ico`
(alias of the 192px PNG), bundled CSS/JS. GET `/` is an authenticated page (401
otherwise). `/manifest.webmanifest` requires auth and returns a private start_url.
Do not confuse root plugin `manifest.json` with the web-app manifest.

## Voice settings and model onboarding

Owner: `lib/voice-settings.mjs`. GET and successful POST return
`{settings:{stt,tts,maxRecordingSec},models:{whisper,piper},status:{stt,tts}}`.
POST accepts a partial direct patch or `{settings:patch}`; unknown fields are
rejected. Editable fields and limits:

| Field | Accepted values |
| --- | --- |
| `stt.engine` | `auto`, `cli`, `server`; compatibility preference, actual runtime is local CLI |
| `stt.model`, `tts.voice` | 1–100 safe ASCII name characters, no `..`; see module for exact validation |
| `stt.modelPath`, `tts.modelPath` | empty or existing absolute/`~/` path, max 4096 chars; .bin / .onnx plus matching .onnx.json |
| `stt.language` | supported Whisper language code or `auto` |
| `stt.serverPort` | integer 1–65535; reserved compatibility setting, not a remote STT URL |
| `tts.speed` | number 0.5–2 |
| `maxRecordingSec` | integer 1–600 |

Apply a complete validated candidate privately before mutating runtime config;
preserve unrelated settings. Active chat, STT/TTS (including incoming recording)
or model setup blocks edits with 409. A failed write leaves runtime unchanged.
Installed files can be reused in place; no general path upload or recursive home
scan. Never revive an unauthenticated Whisper server based on the legacy engine.

Owner: `lib/voice-setup.mjs`, pinned catalog/verifier in `server/setup.mjs`.
GET `/api/voice-setup` returns `job`, `needsConfiguration`, `missing`, `runtime`,
and model catalog metadata. Job contains `state` (`idle`, `downloading`, `complete`,
`error`), `received`, `total`, `file`, `error`. Reads never start downloads.
POST accepts only `{consent:true}`, returns 202, and starts at most one background
job. Busy/concurrent setup -> 409, invalid consent -> 400. Existing configured or
discovered models are reused; otherwise pinned Whisper base.en and Piper LJ Speech
medium artifacts download with exact size/SHA-256 verification and .part cleanup.
Do not accept arbitrary URLs or install binaries/packages from this endpoint.

Poll readiness/progress while Settings is visible; byte counts must be real.
Refresh settings after completion and block edits during setup so an install
cannot overwrite an in-progress draft. Failures are retryable without exposing
provider/path diagnostics. The guide offers personalization, model setup and an
optional user-triggered microphone permission check, with text-only continuation.
Whisper/Piper/FFmpeg binaries are reported separately from model files.

## Kanban schema and mutations

Owners: `lib/kanban.mjs` (state), `lib/kanban-runner.mjs` (queue),
`kanban-cli.mjs` (local tool), `frontend/src/kanban-board.jsx` (UI).
GET returns `{revision,tasks,hostDate,timeZone}`. Dates are host-local calendar
strings; never derive due-date highlights from the phone's UTC date.

Task fields: `id`, `title` (1–200), `notes` (0–8000), `priority`
(`low|normal|high|urgent`), `dueDate` (empty or valid YYYY-MM-DD, years 2000–9999),
`recurrence:{frequency:none|daily|weekly|monthly,interval:1..365}`, `status`,
`execution`, `attempts`, timestamps, `lastError`, optional run/recurrence IDs.
`status` is `todo|doing|done` (Next up / In progress / Done). Execution is
`idle|queued|running|completed|failed|interrupted`; it is not inferred from column.

POST `/api/kanban` body includes the current `revision` and, for retry-safe clients,
a unique `requestId` (8–100 word/hyphen characters). The latest 100 IDs/payload hashes
persist. Resend the identical payload/ID after an uncertain response; altered
payload with that ID or stale revision -> 409. No automatic mutation retry on 409.

| `action` | Additional fields / behavior |
| --- | --- |
| `create` | `title`, optional notes/priority/dueDate/recurrence; new idle task in Next up |
| `edit` | `id` and detail fields; no execution/run-ID editing |
| `move` | `id,status`; Done marks completed and may create one recurring occurrence |
| `delete` | `id`; pre-change recovery snapshot remains |
| `queue` | `id`; creates a run ID, puts queued work in Next up; duplicate active/Done runs rejected |
| `cancel` | `id`; queued -> Interrupted; running work requires the stop route |
| `advance` | `id`; complete this task and queue the first other idle Next up task, if any |
| `restore` | `backup,confirm:true`; validates a complete snapshot and saves a recovery point first |

Board cap: 200 tasks. Queued/running tasks cannot be edited/moved/deleted/requeued.
Completing recurrence creates one new idle occurrence; it does not queue it.
Use host-local calendar arithmetic and clamp month ends; avoid duplicating an
occurrence if the same completion arrives twice.

Runner starts only explicit queued work and shares the active chat/speech lock,
agent adapter/session and history. Each successful agent turn moves its task Done;
failed/interrupted work never retries itself. Stop targets the actual AbortController;
do not make Retry available while the old process is still releasing. Restarted
queued/running work becomes Interrupted. Task content is untrusted user content,
not a system instruction. A task run must not requeue or move its own running ID.

The local CLI uses the private socket with auth headers: `jarvis board list`,
`add TITLE`, `edit ID JSON`, `move ID todo|doing|done`, `queue ID`, `delete ID`,
`advance ID`. A successful tool call or fixture check does not authorize executing
unrequested real tasks or automatically advancing a user's queue.

## Backup and restore boundaries

Snapshot format: `{format:"jarvis-kanban",version:1,createdAt,revision,tasks}`.
Canonical state and snapshots use private atomic files outside the repo. Every
mutation/run transition saves the pre-change snapshot before committing canonical
state; keep the last 20. GET exports do not mutate state or expose request-ID/auth
storage. Backups contain private user-entered titles/notes, not bridge credentials.

UI import previews the file and requires a separate Restore confirmation. Maximum
8 MiB / 200 tasks. Restore requires no queued/running work, validates IDs/details,
increments the live revision instead of reusing the backup revision, and converts
unfinished imported work to Interrupted. A restore never restarts tasks or reverses
model/tool side effects. Keep the revision reviewed by the user in editor/restore
requests, so polling cannot silently bless a stale edit or destructive restore.


### PostgreSQL Kanban storage

When the shared bridge PostgreSQL connection is configured, Kanban uses the same
project database and schema. The versioned `kanban_state` table stores the board,
request deduplication records, and the latest 20 pre-change history snapshots.
Every mutation and run transition commits the board and recovery history in one
transaction under a database lock. Concurrent stale revisions return 409. Reads
and writes fail closed if configured storage is unavailable.

On the next bridge startup, existing board and backup JSON files are imported once
without deleting or rewriting originals. Later startups use PostgreSQL and mark
unfinished queued/running tasks Interrupted. Restart only when no reply is active.
Unconfigured installations retain JSON storage. Original JSON files are migration
recovery copies, not up-to-date exports after switching; use the authenticated
board backup API for current board exports and normal database backups for the
complete database. Restore retains the existing review/confirmation requirement.

Verify using `node tests/kanban.mjs`, `node tests/kanban-runner.mjs`,
`node tests/kanban-bridge.mjs`, and
`JARVIS_TEST_DATABASE_ENV=PRIVATE_PROJECT_ENV node tests/postgres-kanban.mjs`.
The PostgreSQL test uses synthetic tasks in a disposable random schema.

## Calendar and notification inbox

`lib/planner.mjs` owns built-in calendar validation, recurrence, reminder collection
and persistent notifications. It uses the shared PostgreSQL connection or private
JSON on unconfigured installs; failures never silently switch backends. Calendar
and inbox routes require the normal bridge credential and same-site JSON mutations.
See `docs/API.md` for event fields, revision/idempotency rules and scheduler limits.
`calendar-cli.mjs` uses the private authenticated socket. `frontend/src/calendar.jsx`
owns the month grid, series editor and inbox; navigation remains in the dashboard.
Run `tests/planner.mjs` (also with an isolated PostgreSQL schema),
`tests/kanban-bridge.mjs`, `tests/theme-browser.mjs`, and rebuild frontend assets.
