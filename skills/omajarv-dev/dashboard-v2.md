# JARVIS 2.0 dashboard development

Use this guide when the chosen checkout contains `frontend/src/dashboard.jsx` and
`package.json`. Keep the checkout chosen by the user: the installed version-one
plugin, another worktree and this dashboard can be different versions. API changes
use [api-v2.md](api-v2.md); detailed contracts live in the chosen repo's `docs/API.md`.

## Find the owner before editing

| Concern | Source |
| --- | --- |
| Workspace navigation, saved-chat list, React portals | `frontend/src/dashboard.jsx` |
| Kanban cards, filters, editor/restore dialogs, touch/keyboard moves | `frontend/src/kanban-board.jsx` |
| Voice settings and guided model setup | `frontend/src/voice-settings.jsx`, `voice-setup.jsx` |
| Three.js reactor and live state/amplitude rendering | `frontend/src/reactor.js` |
| Tailwind input and scoped dashboard styles | `frontend/src/dashboard.css` |
| Owned UI primitives | `frontend/src/components/ui/` |
| Portal target elements and page assets | `server/public/index.html` |
| Auth helper, chat/voice, workspace routing and theme polling | `server/public/jarvis.js` |
| Generated bundle and stylesheet | `server/public/dashboard.js`, `dashboard.css` |
| Authenticated HTTP/SSE routes and shared execution lock | `server/jarvis-server.mjs` |
| Board schema/storage/idempotency/backups/recurrence | `server/lib/kanban.mjs` |
| Serialized queue and cancellation lifecycle | `server/lib/kanban-runner.mjs` |
| Local authenticated board tool | `server/kanban-cli.mjs`, exposed by `jarvis board` |
| Voice config patching and setup jobs | `server/lib/voice-settings.mjs`, `voice-setup.mjs` |
| Pinned download catalog/verifier, bounded discovery | `server/setup.mjs`, `server/lib/models.mjs` |
| Saved conversations and active history | `server/lib/history.mjs` |
| Palette, public icons/offline behavior | `server/lib/theme.mjs`, `server/public/sw.js` |

Keep business rules in the owning server module. Route handlers authenticate,
validate bounded request bodies and translate errors. React calls
`window.jarvisAPI`; do not duplicate token storage, status fetches, agent spawning
or model download logic inside individual components. Existing voice/chat DOM is
still managed by `jarvis.js`; React owns its portals, not those same child nodes.

## Efficient edit/build loop

1. Read the relevant component, module and targeted test together. Search the route
   and both consumers before changing a shared payload; native QML still exists.
2. Install dev dependencies with `npm ci` only when needed (fresh checkout, missing
   modules or lockfile changes). Do not reinstall for every CSS/JS edit.
3. Run `npm run build:frontend` after changes to `frontend/src`, `jarvis.js`, asset
   links or their loading contract. `frontend/build.mjs` uses esbuild and Tailwind,
   writes both generated assets, and updates content-based versions in index.html.
   Commit sources, generated assets and the updated index together. Runtime
   installation serves these files and requires no npm dependency install.
4. Frontend asset edits need a browser refresh, not a bridge restart. Server module
   edits need a restart of the identified dev process after checking it is idle.
   Do not restart version one or the user service by guessing a terminal/PID.
5. Use the smallest relevant tests below, then inspect the diff. Broaden checks for
   a newly exposed risk or failure, not just to repeat already passing checks.

Add a workspace page by creating its section in index.html, adding it to
`window.jarvisWorkspace` (visibility and selected navigation), rendering its React
portal, and hiding conversation controls for that page in the scoped stylesheet.
Keep DOM IDs used by existing chat, speech and personality handlers stable.

Use scoped names such as `.kb-columns`: legacy `jarvis.css` defines global `.grid`
for the animated backdrop, which can conflict with Tailwind's `grid` utility.

## State, interaction and theme contracts

- Board column (`todo`, `doing`, `done`) is independent of execution state. A manual
  move to In progress is not evidence that a process is running. Queue starts work
  only on an explicit request; the runner shares chat/speech locks and sessions.
- Keep a synchronous ref lock for in-flight mutations. For an uncertain network
  result, resend the exact payload and requestId; do not create a new request or
  silently replay changes after a 409. Polling must not replace newer revisions or
  erase mutation errors. Editors/restore previews retain the revision reviewed by
  the user; stale dialogs must be reviewed again.
- All task changes go through the board API, including the local CLI. The CLI uses
  the authenticated private Unix socket, so explicit HTTP dev mode needs no TLS
  certificate. Never fall back to an impersonatable TCP port or remove auth.
- Completion creates one next recurring occurrence; restoring/restarting unfinished
  runs produces Interrupted and never executes them automatically. Snapshots and
  request IDs are storage behavior, not UI-only features.
- Due dates are YYYY-MM-DD calendar strings. Compare against API `hostDate`, not
  `toISOString()` or the phone's clock/timezone. Use host-local calendar arithmetic
  and month-end clamping for recurrence; preserve local dates across DST changes.
- Keep finger dragging on a dedicated Pointer Events grip with touch-action:none;
  retain normal scrolling elsewhere. Mobile columns swipe with column shortcuts,
  filters collapse, controls have at least 44px touch targets. Preserve focus after
  moves, keyboard alternatives, visible focus, dialog focus/cancel and labels.
- Tailwind semantic colors map to Omarchy CSS variables; use the same live tokens
  for cards/dialogs/statuses and Three.js. `/theme.css` supplies first paint and
  authenticated `/api/theme` refreshes visible clients every two seconds. Keep the
  last valid palette through theme-file swaps. Do not bake one theme into assets.
- Keep install icons public and credential-free: explicit PNG favicon/apple-touch
  links, manifest icon URLs, `/favicon.ico` alias. The worker caches public palette
  CSS and icons only, never conversations, API responses or token-bearing pages.

## Targeted verification

| Change | Useful checks |
| --- | --- |
| UI/styles, touch, keyboard, filters, restore, theme | `npm run build:frontend`; `node tests/theme-browser.mjs` |
| Board storage, recurrence, dates, idempotency, snapshots | `node tests/kanban.mjs` |
| Queue serialization, failure, cancellation and retries | `node tests/kanban-runner.mjs` |
| CLI, actual bridge/adapter queue, locks and PWA icons | `node tests/kanban-bridge.mjs` |
| Voice patch validation and persistence | `node tests/voice-settings-unit.mjs`; `node tests/voice-settings.mjs` |
| Model setup consent/progress/reuse/retry | `node tests/voice-setup.mjs`; `node tests/onboarding.mjs` |
| Shared agent/history/auth/SSE/reset behavior | `node tests/integration.mjs` |
| Theme parsing and atomic palette swaps | `node tests/theme.mjs` |

Browser fixtures cover desktop 1280px and mobile 390px/320px with fake data. They
exercise touch dragging, real keyboard events, safe lost-response retry and restore
confirmation. Advance a fresh virtual-time budget after async actions; an expired
budget pauses rendering/fetch completion. Bound CDP calls. Avoid awaiting an
animation/scroll promise while virtual time is paused; scroll test fixtures with
instant behavior and return a plain value. Wait for observable results rather than
assuming a request arrived as soon as click returned.

`node --check` works for server .mjs and plain .js, not JSX; the frontend build
parses JSX. Tests use fake agents/downloads and temporary runtime state; no actual
provider request or model-weight download is needed. If the sandbox blocks a test
listener or child process, use the authorized escalation flow, not weaker tests.

## Dev instance and tailnet

Prefer a separate dev HOME/state/workspace and unused loopback port. Inspect the
actual launcher first; paths and ports are machine context, not portable defaults.
A temporary HOME does not isolate systemd, DBus or Tailscale: mock lifecycle tools
in tests; isolate runtime/bus variables for dev; do not modify an existing Serve
listener. Reuse existing provider login only when authorized, without copying keys
or enabling full-access flags. An agent can be installed but not signed in.

Serve private tailnet HTTPS to the dev instance's mode-0600 Unix socket on a free
HTTPS port when 443 belongs to version one. Inspect Serve first, preserve other
listeners and never enable Funnel. Do not restart a busy bridge. Verify anonymous
401 and authenticated success without logging tokens, transcripts or access URLs.
Use the user's integrated browser via its available CLI; load the relevant browser
skill when needed. Source edits/skill updates do not authorize publication or push.

## Animated core asset

`server/public/core.glb` is the Blender core export (six rotor clips plus plasma).
`frontend/src/reactor.js` plays all clips with a shared mixer, applies live Omarchy
palette tokens to embedded materials, and maps bridge activity/audio to tempo,
pulse and glow. Reduced motion freezes transforms. Loading failures retain the
procedural reactor. The release allowlist includes this specific GLB only.
Run `JARVIS_TEST_WEBGL=1 node tests/theme-browser.mjs` to verify the actual model
and seven clips in software WebGL, alongside the desktop/mobile theme checks.


## IP camera input

Camera onboarding lives in `frontend/src/camera-settings.jsx`, its authenticated
JPEG/PCM consumers in `camera-media.js`, and bounded FFmpeg lifecycle/settings in
`server/lib/ip-camera.mjs`. Settings are mounted inside the existing sidebar Settings
page. Camera input is optional and selected explicitly; do not fall back to a device
microphone if a camera connection fails. Preserve stop/cancel behavior and the
`jarvis-camera-ended` notification, which cancels rather than uploads partial audio.
Tests: `tests/ip-camera.mjs`, `tests/camera-media.mjs`, camera route checks in
`tests/voice-settings.mjs`, and camera workflows in `tests/theme-browser.mjs`.
Never put the saved RTSP URL into API views, logs, screenshots or board notes.
