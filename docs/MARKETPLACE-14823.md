# Marketplace review 14823 follow-up

Review: https://github.com/omacom/omarchy-plugin-marketplace/issues/14823
Reviewed submission: `c00be2d4cd2365367234339612628fa91c6e3168`.

## Local changes

- All four native editors intercept keyboard paste before Qt's native input
  handler. Middle-click PRIMARY paste uses the same external bounded reader.
  Native right-click paste menus are suppressed; left-button selection and copy
  remain available. Text is limited before insertion into the selected field.
- Clipboard helpers have byte limits, absolute deadlines and process-group
  termination on timeout, overflow, cancellation and bridge exit.
- Piper help and synthesis have deadlines and diagnostic limits. Audio files
  have a kernel-enforced 16 MiB limit and a bounded read. Synthesis admits one
  active request without queuing, and removes temporary output on failure.
- Recording/playback and finite native helpers have deadlines and process-group
  cleanup. The bridge bounds incoming commands, simultaneous dispatches, HTTP
  responses, stream bytes/events, accumulated text and queued stdout.
- Agent transports bound stdout, stderr, accumulated replies, cumulative-message
  sources and Hermes RPC/command queues. HTTP SSE writes have total and queue
  limits. Shutdown aborts active turns and kills tracked process groups.
- The installer no longer automatically installs `piper-tts-bin` after a source
  build failure. This removes the optional fallback from installation; it does
  not claim to establish provenance of existing user-installed Piper binaries.

Exact thresholds are maintained in SECURITY.md. Exceeding a limit stops the
operation; large replies and long speech may therefore fail rather than finish.

## Verification

These commands passed against the local source with isolated fixtures:

```sh
node tests/native-hardening.mjs
node tests/agents.mjs
node tests/integration.mjs
node tests/marketplace-install.mjs
node tests/install.mjs
QT_QPA_PLATFORM=offscreen QT_QPA_PLATFORMTHEME='' QT_QUICK_CONTROLS_STYLE=Basic \
  /usr/lib/qt6/bin/qmltestrunner -input tests/qml/tst_clipboard.qml -o -,txt
omarchy plugin validate .
omarchy plugin validate plugin/h3man.jarvis
```

The Qt test reports four passes, including both TextArea and TextField routing.
Helper fixtures cover normal/oversized/stalled clipboard transfers, PRIMARY
selection, process descendants, filesystem output limits, Piper discovery and
synthesis flooding/deadlines, the speech concurrency lock and native input limits.
Agent fixtures cover oversized raw output and replies, normal sessions and ACP
cancellation. Integration also covers text/PRIMARY and image clipboard delivery.
Installer tests mock service/package commands. Source packaging includes the new
runtime files, and changed QML/JavaScript/shell files pass parsing/syntax checks.

The tests use fake clipboard owners, fake agents and fake Piper. They do not
reproduce the original finding inside a live Wayland shared shell, read the real
clipboard, run real conversations, restart the installed plugin or download models.
No claim of an independent 84-file security audit or marketplace approval is made.
The exact submitted commit requires maintainer re-review before the marketplace
submission can be approved.
