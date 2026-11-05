# Architecture and source map

Repo: https://github.com/Robindoris/omajarv . Source is plain QML, shell and Node.js
ES modules; there is no npm build step or application dependency install. Node 22+
is required. Read README.md, PRIVACY.md and SECURITY.md for current user behavior.

| Area | Files |
| --- | --- |
| Marketplace contract | root manifest.json; entry point plugin/h3man.jarvis/BarWidget.qml |
| Native bar and popup | plugin/h3man.jarvis/BarWidget.qml and Panel.qml |
| Local command/service install | bin/jarvis, install.sh, systemd/*.template |
| HTTPS/API/static files | server/jarvis-server.mjs |
| Native JSON bridge | server/desktop.mjs |
| Phone interface | server/public/index.html, jarvis.js, jarvis.css, sw.js |
| Coding agents/session memory | server/lib/agent.mjs, config.mjs |
| Personality and learned preferences | server/lib/personality.mjs |
| Private uploads | server/lib/attachments.mjs |
| Agent model discovery | server/lib/agent-models.mjs |
| Phone sudo approval | server/lib/sudo.mjs, server/sudo-askpass.mjs, server/sudo-run.mjs |
| Private Tailscale backend | server/lib/serve-socket.mjs |
| Shared transcript | server/lib/history.mjs |
| Speech | server/lib/stt.mjs, tts.mjs, models.mjs |
| Setup/model consent | server/setup.mjs |
| Phone transports | server/lib/net.mjs, tunnel.mjs, tailscale.mjs |
| Dynamic palette | server/lib/theme.mjs |
| Source package allowlist | scripts/build-release.mjs |

Both interfaces call the same authenticated API. POST /api/chat streams SSE meta,
token, done and error events. GET /api/history synchronizes saved conversations
while clients are idle. POST /api/chat/stop aborts the active agent request.
POST /api/session/reset clears shared history, remembered agent sessions and uploads;
it preserves names and the personality prompt.
Only one agent request is active at a time; reset/concurrent requests must respect it.
Check docs/API.md and the route handler before changing the protocol.

The native panel starts `jarvis desktop` and sends newline-delimited JSON on stdin;
server/desktop.mjs returns JSON lines on stdout. Keep stdout machine-readable and
use events/states consistently in Panel.qml. Errors must release busy states.
The helper uses authenticated loopback HTTPS and trusts the local certificate.

Agent resolution follows config.agent or Omarchy's defaults/agent file. Code adapters
normalize CLI output. Session IDs and the last 100 transcript messages per agent
persist separately. Do not assume every adapter supports resume, streaming or
permission flags identically; inspect the installed CLI when changing an adapter.

After a change to event shape, session handling or state transitions, inspect both
the native and browser consumers. A UI-only state is not a reason to fork the actual
agent conversation or make a second backend.

Personality, attachments and model selection share the same desktop/phone backend;
see [conversation.md](conversation.md). Phone sudo uses a separate encrypted
approval channel; see [voice-security.md](voice-security.md).
