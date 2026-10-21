# JARVIS for Omarchy

A native desktop and phone assistant for your default Omarchy coding agent. Includes
text chat, optional local Whisper/Piper speech, shared history, activity indicators,
QR handoff through LAN/Cloudflare/Tailscale, and live Omarchy theme colors.

## Install and first run

Requires Omarchy Quattro, Node.js 22+, curl, jq and OpenSSL. From this repository run
`bash install.sh`, or install the marketplace plugin and click **Assistant → Open
setup**. Setup runs in your own terminal and asks before installing packages or
models. It finds existing Whisper/Piper models and lets you reuse them in place,
download verified defaults, or skip voice for text-only chat. See [models](docs/MODELS.md).

New installs listen on loopback only, with Cloudflare off and full-agent access off.
Setup offers private desktop/Tailscale, LAN, or explicit public Cloudflare access.
For Tailscale install/connect the phone and computer to your tailnet, then use
**Phone → Tailscale → Enable**. It does not enable public Funnel. Cloudflare is
optional and requires installing `cloudflared`; its link changes when restarted.
LAN needs local-network access and accepting the self-signed HTTPS certificate.

CLI: `jarvis start`, `stop`, `restart`, `status`, `setup`, `setup-status`, `models`,
`phone`, `toggle`, `qr`, `reset`, `tailscale-status`, and `tailscale-enable`.
`jarvis token` intentionally prints your access credential; never share its output.

## Use

Click the reactor to open Assistant. Enter sends text; Microphone records and Finish
recording transcribes and sends. Stop cancels; Read aloud enables Piper playback.
The activity card shows elapsed time, waiting/receiving/listening/speaking and errors.
New conversation clears shared history and agent session IDs. Phone and desktop use
the same JARVIS conversation, independently of unrelated terminal agent sessions.

In Phone choose Cloudflare, LAN or Tailscale, then scan the QR in your phone browser.
Allow microphone access if using speech. Supported browsers can install the page as
an app. Page, reactor and browser colors follow the active Omarchy theme within five
seconds while visible. No bridge restart is needed for a theme change.

Optional shortcut in `~/.config/hypr/bindings.lua` (check for an existing binding first):

```lua
o.bind("SUPER + CTRL + J", "JARVIS assistant", "jarvis toggle")
```

## Privacy and agent permissions

Read [PRIVACY.md](PRIVACY.md) and [SECURITY.md](SECURITY.md). Speech processing is local,
but your chosen agent may send prompts and file contents to its provider. The plugin
contains no telemetry. A bearer access link lets its holder use your agent: keep it
private. Agent access is not a guarantee that secrets cannot be read or disclosed.

Configuration: `~/.config/omarchy-jarvis/config.json`. New installs do not bypass agent
permissions. Experienced users may explicitly enable `codexFullAccess` for Codex or
`agentFullAccess` for other adapters that support automatic approvals; this can give
requests the current Linux user's full rights. Root authentication remains separate.
Existing configuration is preserved and is never included in source releases.

Runtime credentials/history: `~/.local/state/omarchy-jarvis/`. Model files:
`~/.local/share/omarchy-jarvis/models/`. Model setup never uploads local paths or files.

## Remove

Run `jarvis uninstall` **before** generic marketplace removal. It stops/disables the
user service, removes the CLI symlink and plugin, and keeps models/config/history.
Generic marketplace removal alone cannot stop an independently installed service.
Back up or explicitly delete retained JARVIS data separately if you want it erased.

## Development and release preparation

Run `node tests/onboarding.mjs`, `node tests/theme.mjs`, `node tests/tailscale.mjs`,
`node tests/integration.mjs`, and optionally `node tests/theme-browser.mjs` (Chromium).
Tests use temporary homes and fake agents; they do not publish or download models.

`node scripts/build-release.mjs /absolute/empty/output` prepares an allowlisted
source package and SHA256SUMS. It excludes runtime config, credentials, keys, models,
recordings, logs and conversations, and refuses symlinks. Validate the output with
`omarchy plugin validate /absolute/empty/output`. Nothing uploads automatically.
Publish only after reviewing the package and explicitly approving the repository
upload and marketplace submission. See [release review](docs/RELEASE-REVIEW.md).

JARVIS source is MIT licensed. Runtime dependencies and optional downloaded models
retain their own terms; no model weights are redistributed in this package.
