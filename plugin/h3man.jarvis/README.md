# h3man.jarvis — Omarchy desktop assistant

Click the reactor or press **Super + Ctrl + J** to open JARVIS.

- **Assistant**: shared transcript, text input (Enter to send), microphone recording,
  Stop, Read aloud, and New conversation. Follows the configured Omarchy agent.
- **Phone**: scannable QR, Tunnel/LAN selection, Retry, Copy link and Open.
- **Escape**: close the panel. Closing while recording cancels microphone capture.
- **Right click** the reactor to refresh bridge status.

The header shows the active agent and access level. Bridge Start/Stop stays in the
footer. Phone and desktop share session memory and persisted history through the
local bridge; no second agent session is created for desktop chat.

Settings in `shell.json`: `animate` (default true), `pollSeconds` (default 20).
Native recording/playback require `pw-record`/`pw-play`. Plugin files under
`~/.config/omarchy/plugins/h3man.jarvis/` reload automatically on save.
