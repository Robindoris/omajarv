# Privacy and data flow

JARVIS does not contain telemetry, analytics, crash reporting, an upload collector,
or a developer-controlled remote service. The release contains source code and
JARVIS icons. Personal configuration and credentials are not distributed.

## What stays local

Microphone recordings are captured only after the user activates recording. Whisper
transcribes recordings locally and Piper generates speech locally. Temporary audio
is removed after processing. Closing the desktop panel during recording cancels it.
Shared transcripts (last 100 messages per agent), agent session IDs, the access token,
and the HTTPS private key live under `~/.local/state/omarchy-jarvis/`, outside the
plugin source. Private directories use mode 0700; sensitive files use 0600.
Transcripts are saved locally; New conversation clears them and agent session IDs.
The browser remembers its bearer token in session storage and its installed app
start URL. Treat the browser profile, access link, QR, and screenshots as credentials.

## What can leave the machine

- Your chosen coding agent can send prompts, transcript text, tool output, files and
  credentials to its provider according to that agent's own behavior and settings.
  Local speech models do not make a cloud coding agent local. JARVIS cannot promise
  that an unrestricted agent will never read or disclose secrets.
- Full-access execution is disabled for new installs. Enabling `codexFullAccess`
  or `agentFullAccess` grants the respective agent the user's account permissions.
  Existing personal settings are preserved, never copied into a release.
- Optional Cloudflare tunnels relay phone traffic through Cloudflare, where TLS is
  terminated. They are disabled by default. Install cloudflared separately if chosen.
- Optional Tailscale Serve depends on the user's existing tailnet and phone access.
  JARVIS does not enable public Funnel and refuses to overwrite other Serve listeners.
- Consented model downloads contact Hugging Face and its CDN and disclose the usual
  IP/request metadata. Package managers contact configured repositories/AUR.
  No recordings, conversations, credentials, or local model paths are uploaded by setup.

Fresh installs listen only on loopback. LAN access or a public tunnel requires an
explicit networking choice. All APIs require the access token. An anonymous request
never receives that token, regardless of LAN, proxy headers, or connection origin.
The palette-only stylesheet is public; conversation and setup information are not.

No access link or transcription text is written to normal server logs. Agent errors
may still contain provider details; review logs before sharing them. There is no
claim that the process is sandboxed by JARVIS. Omarchy plugins themselves run with
your user permissions. Review the source and the configured agent before use.

The service worker caches only theme CSS for offline colors. It does not cache API
responses or conversation pages. Offline speech and responses require a running
computer; optional phone networking services must also remain connected.
