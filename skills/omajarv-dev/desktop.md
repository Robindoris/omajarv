# Native desktop and live deployment

Edit plugin/h3man.jarvis/ in the chosen checkout. Root manifest points into that
folder; its nested manifest supports the legacy standalone native plugin layout.
Keep both valid when changing entry points or metadata.

Use qs.Ui and qs.Commons components/tokens: Ui.Panel, Ui.KeyboardPanel, Ui.Button,
Style and Color. Font tokens include `bodySmall` and `caption`, not `small`. Alias qs.Ui when the local file is also named Panel.qml to avoid
recursive component resolution. QtQuick.Controls can be imported with a separate
alias for text inputs, scrollbars and related controls.

BarIconButton custom art belongs in iconComponent. A canvas added as an unrelated
child with empty text can leave the button classified as empty/invisible. Preserve
open/close/toggle lifecycle on the bar widget so shell registry routes and shortcuts
work. Prefer `jarvis toggle` / `omarchy-shell shell summon h3man.jarvis` for lifecycle
checks over relying on a stale per-widget IPC target after hot reload.

Panel structure:

- Assistant: setup when needed, activity card, shared transcript, text input,
  microphone/finish recording, Stop, Read aloud and New conversation; Personality,
  agent-specific model controls, Attach files/Paste image and removable pending files.
- Phone: Cloudflare/LAN/Tailscale choices, complete QR, transport status, copy/open.
- Footer: setup and bridge controls.

Use layouts with bounded scrolling so controls stay inside the border on shorter
screens. Keep input focus on opening Assistant; Enter sends, Escape closes. Show
elapsed activity from real transitions; distinguish generating audio from playback.
Close/cancel must not leave recording active. Phone selection must not create a
new chat session. Preserve plain-text rendering and safe transcript selection.

## Identify what is installed

Read `readlink -f ~/.local/bin/jarvis` and the user service's WorkingDirectory and
ExecStart. The installed plugin under ~/.config/omarchy/plugins/h3man.jarvis/ may be:

1. A legacy flat copy with Panel.qml/BarWidget.qml at its root and backend elsewhere.
2. A full marketplace copy with root manifest and plugin/h3man.jarvis/ below it.

Inspect before copying; do not assume both layouts are live. Copy only the intended
source files, with backup for an existing user-owned copy. Validation is read-only:

```bash
omarchy plugin validate .
omarchy plugin validate ~/.config/omarchy/plugins/h3man.jarvis
```

Plugin hot reload can retain an old loaded Panel.qml. If the UI is still old after
saving, an Omarchy shell restart may be necessary; do not repeatedly patch already
correct source. For server changes, wait for authenticated status.chatBusy to clear
before restarting omarchy-jarvis.service. A shell reload also destroys helper
processes, so consider an active native conversation before restarting it.

Use the Omarchy skill for actual shell config/keybindings. This machine's existing
shortcut is Super+Ctrl+J, but check live bindings rather than overriding blindly.
Do not use `omarchy refresh shell` as a restart: it resets user configuration.


Native clipboard reads must stay outside Qt's GUI input path. All editable fields
forward paste keys to PasteGuard before the native handler; it also intercepts
middle-click PRIMARY and suppresses native right-click paste menus. Route reads
through server/lib/clipboard.mjs and bounded-process.mjs, preserving explicit-user
paste and selection choice. Finite native CLI requests use `jarvis native-command`
so QML collectors only see bounded output. Keep limits aligned with SECURITY.md.
Run `node tests/native-hardening.mjs`, `node tests/integration.mjs`, and the Qt 6
`qmltestrunner -input tests/qml/tst_clipboard.qml` with the offscreen platform and
Basic controls style; `/usr/bin/qmltestrunner` may be an incompatible Qt 5 build.

Agent transports and HTTP SSE also bound cumulative input/output and pending
writes before data reaches the native panel. Managed subprocesses are registered
for exit cleanup, and server shutdown aborts the current turn. Run tests/agents.mjs
and tests/integration.mjs after changing these limits or lifecycle behavior.
