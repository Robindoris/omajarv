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

The phone's Administrator permission dialog encrypts its password for a temporary
local sudo askpass helper. The bridge relays ciphertext without decrypting it;
the helper delivers the plaintext only to sudo's password pipe. JARVIS does not
include passwords in agent prompts, conversations, normal logs or persistent
storage. This does not prevent an unrestricted agent running under the same Linux
account from inspecting or modifying the local authorization machinery. Command
arguments are shown on the phone, and command output still reaches the agent and
may reach its provider. A trusted HTTPS page and trusted local agents are required.

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

No access link, personality prompt or transcription text is written to normal
server logs. Raw agent and speech-tool diagnostics are not forwarded to logs,
history or error responses because those tools can echo prompts and credentials.
Agent CLI/provider storage and logs remain under those tools' own policies. There is no
claim that the process is sandboxed by JARVIS. Omarchy plugins themselves run with
your user permissions. Review the source and the configured agent before use.

The service worker caches only theme CSS for offline colors. It does not cache API
responses or conversation pages. Offline speech and responses require a running
computer; optional phone networking services must also remain connected.

File attachments are uploaded only after choosing files or explicitly pasting an
image. They are shared with the selected coding agent, whose provider may process
their contents. Pending uploads are private to the local bridge, not web-accessible.
They expire after 24 hours, are deleted on New conversation and normal bridge
shutdown, and abandoned upload directories are removed after 24 hours on next start.
The transcript retains filenames; agent providers may have separate retention.
Each file is limited to 10 MiB, each message to four files, and local upload storage
to 100 MiB and 100 files. No thumbnails or active document content are rendered.
