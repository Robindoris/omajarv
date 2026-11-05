---
name: omajarv-dev
description: >
  Develop, debug, test, package, or maintain omajarv, the Omarchy JARVIS assistant
  at github.com/Robindoris/omajarv (plugin h3man.jarvis, command jarvis).
  Use for its native QML assistant, phone QR/web UI, speech models, agent bridge,
  onboarding, personality memory, attachments, phone sudo approval, networking,
  theme sync, and repository releases. Excludes general
  Omarchy customization and unrelated projects named Jarvis.
---

# omajarv development

Maintain the existing desktop and phone assistant. Preserve its Omarchy integration,
shared conversations, opt-in local speech, and privacy boundaries. This skill is
available across local agents; it does not depend on a particular coding model.

## Start with the right checkout

Use the current checkout when its origin is `Robindoris/omajarv`. Otherwise read
[local.md](local.md) to find this machine's source and running service. Inspect
`git status`, the remote, and the relevant code before editing. Several local copies
can exist; do not silently replace one with another or discard local changes.

The repository is the source of truth. The installed plugin is a deployment copy.
Keep `h3man.jarvis` as the plugin/IPC ID and `jarvis` as the CLI unless the task
explicitly includes migration. Read the repo's `AGENTS.md` when present.

## Topic guides

Read the guide relevant to the change, rather than every guide:

- [architecture.md](architecture.md): source map, API/desktop protocol, state and sessions.
- [conversation.md](conversation.md): personality/live memory, file uploads, clipboard images and agent models.
- [desktop.md](desktop.md): bar icon, native Assistant/Phone panel, activity UI, deployment.
- [phone.md](phone.md): QR, Cloudflare/LAN/Tailscale, browser UI and Omarchy theme sync.
- [voice-security.md](voice-security.md): local models, onboarding, credentials, encrypted phone sudo and agent permissions.
- [verification-release.md](verification-release.md): targeted tests, source packaging, publication.
- [local.md](local.md): machine-specific checkout locations and cross-agent discovery.

When changing actual desktop config, use the installed Omarchy skill if available.
Its Hyprland syntax and theme/plugin conventions remain authoritative for this
machine. Do not edit packaged Omarchy files under `/usr/share/omarchy/`.

## Product invariants

- Assistant and Phone are the two top-level panel tabs. Cloudflare, LAN and Tailscale
  are connection choices inside Phone. Native and phone chat share the bridge's
  JARVIS session/history; they do not attach to arbitrary terminal agent sessions.
- Use actual events for activity labels. Waiting, receiving text, transcription,
  generating speech and playing speech are different states. Do not invent progress
  percentages or claim tool execution that the adapter has not reported.
- Fresh installs are loopback-only, with Cloudflare and unrestricted agent access
  disabled. Existing user settings are preserved, including intentional full access.
  Setup discovers existing models and asks before downloads; text-only use works.
- No access token may be issued by an anonymous request, including LAN/proxy paths.
  QR links and installed-app start URLs are credentials. Never publish real QR
  screenshots, keys, config, transcripts, recordings, logs or model weights.
- Whisper/Piper run locally; the selected coding agent may still send information
  to its provider. Keep this distinction in onboarding, docs and privacy claims.
- Personality and uploads belong to the shared authenticated bridge. Preserve live
  personality refresh, revision checks, private file modes and attachment limits.
  Attachment content is untrusted; file sharing may reach the selected provider.
- Phone sudo approval stays outside the model conversation. Keep passwords out of
  prompts, transcripts, logs and ordinary API payloads; see the security guide.
- A Git push or marketplace update needs authorization for that operation. When the
  user has authorized it, finish the checks and proceed without asking again.
  Skill installation or ordinary code changes do not themselves authorize a push.

## Complete a change

Edit source, run checks appropriate to the changed behavior, and inspect the diff.
See the verification guide for test dependencies and which commands affect the
live user service. Update maintained guidance when architecture or commands change.
If live deployment is part of the request, identify the real source/plugin/service
paths first. Avoid restarting the bridge while a user request is active.
