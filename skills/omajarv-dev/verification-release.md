# Verification and publication

Run checks from the chosen repository root. Select tests for the changed behavior;
a documentation or color-only edit does not automatically require the full suite.

| Change | Useful checks |
| --- | --- |
| Native panel | omarchy plugin validate .; validate nested/installed plugin as appropriate; qmlformat parsing; live runtime logs/layout when deployed |
| Model discovery/download setup | node tests/onboarding.mjs |
| Installer/removal/defaults | node tests/install.mjs |
| Agent/API/auth/history/stop/QR | node tests/integration.mjs |
| Personality/live memory | node tests/personality.mjs; node tests/integration.mjs |
| Upload limits, storage and clipboard delivery | node tests/attachments.mjs; node tests/integration.mjs |
| Agent model picker | node tests/agent-models.mjs; node tests/desktop-models.mjs |
| Encrypted sudo and privacy | node tests/sudo.mjs; node tests/privacy-audit.mjs; node tests/integration.mjs |
| Private Serve socket | node tests/serve-socket.mjs |
| Cloudflare private ingress | node tests/tunnel.mjs; node tests/serve-socket.mjs |
| Offline/local privacy behavior | node tests/offline-status.mjs; node tests/local-privacy.mjs |
| Tailscale | node tests/tailscale.mjs |
| Palette parser | node tests/theme.mjs |
| Phone rendering/theme changes | node tests/theme-browser.mjs |
| Shell/Node edits | bash -n on changed scripts; node --check on changed modules |

Tests need the dependencies stated in README; the browser check needs Chromium,
QR decode needs qrencode/zbarimg, and HTTPS tests need OpenSSL. Tests use temporary
homes/fake agents and must not invoke real conversations or download model weights.
Process/network sandboxes can block loopback servers or child-process checks; use
the environment's authorized escalation flow rather than weakening the test.
QML lint may lack the dynamic qs imports; distinguish that from an actual QML parse
or live loading error. Match reports to checks that actually ran.
Attachment integration fixtures fake zenity/wl-paste; do not read the real clipboard
or choose private user files for tests. Browser tests also cover Personality and
sudo dialogs at mobile sizes. Use fixture screenshots, not authenticated live pages.

## Source packages

Keep `skills/omajarv-dev/` current with feature changes; it is the portable skill
installed by `scripts/install-skill.mjs` into shared user skills only with explicit `--install-agent-skill` consent. Never
copy a developer machine's personal `local.md` into that bundle.

scripts/build-release.mjs uses an allowlist and rejects credential signatures and
symlinks. Output must be an empty directory outside the source root. Verify its
root manifest, file list and SHA256SUMS. When adding a new runtime file, ensure the
builder actually includes it; do not casually broaden it to copy the whole home,
checkout metadata or hidden runtime files. Keep private screenshots/config/audio,
models, tokens, TLS keys, logs, transcripts and .git out of distributables.

Read README.md, docs/RELEASE-REVIEW.md, PRIVACY.md and SECURITY.md before publication
changes. Keep user-facing setup instructions concrete and accurate. Model terms,
user-service removal limitations and provider data flow remain visible.

## GitHub and marketplace

Source destination: https://github.com/Robindoris/omajarv . The existing submission
is https://github.com/omacom/omarchy-plugin-marketplace/issues/12542 . Read its current
state if doing marketplace work; do not assume accepted/rejected based on old notes,
and do not create a duplicate submission for ordinary updates.

Respect authorization for pushes, tags, releases and external comments/submissions.
The earlier approval to publish a particular change is not an indefinite approval
for future unrelated changes. Once the current action is authorized, complete it
without another routine confirmation. Use the approved destination and preserve
remote history. Avoid publishing a personal email unintentionally; this author's
GitHub noreply identity can be used when appropriate, checking current identity.

Local skill/instruction changes alone are not permission to push them. Keep global
machine paths and runtime context in the local skill, not in a public source package.
