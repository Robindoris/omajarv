# omajarv development instructions

This repository is Robindoris/omajarv, the Omarchy JARVIS assistant. Its plugin ID
is `h3man.jarvis` and its CLI is `jarvis`.

For development, load the **omajarv-dev** skill. If your agent does not expose a
skill tool, read `~/.agents/skills/omajarv-dev/SKILL.md` directly and the linked guide
for the part you are changing. This local skill is shared across coding agents.

If the local skill is unavailable, start with README.md, PRIVACY.md and SECURITY.md.
The native UI is in `plugin/h3man.jarvis/`; the bridge and phone UI are in `server/`.
Preserve shared phone/desktop sessions, opt-in model downloads, loopback defaults,
and the source package allowlist. Do not publish real access links or runtime data.

Inspect git status and origin before choosing a checkout. Do not assume a deployed
plugin or a second checkout is the latest source, and preserve existing user edits.
Tests use temporary homes and fake agents; installer/removal tests must mock the
real service/package managers. Never use a bare temporary HOME as systemd isolation.

Read the relevant skill guide for targeted tests, native deployment and release
workflow. Do not push or submit external updates merely because a skill was loaded.

## Starting development

When asked to run/start dev, use `npm run dev` in a persistent managed terminal.
When explicitly asked to restart dev, use `npm run dev:restart`. Check
`npm run dev:status` first when ownership is unclear. Do not hand-create a launcher
under /tmp or start another copy of the installed version-one service.

`scripts/dev.mjs` builds the frontend, preserves isolated dev data in the ignored
`.jarvis-dev/` directory and recreates the temporary private-socket alias used by
the dev tailnet listener. Existing dev config/history/models are migrated once.
`npm run dev` reuses a healthy managed server rather than duplicating it. Restart
refuses to interrupt an active reply. See the dashboard guide for browser opening.
