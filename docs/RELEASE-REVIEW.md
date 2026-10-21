# Publication review

Prepared for the Omarchy plugin marketplace. No repository was created, no source
was uploaded, and no listing was submitted during preparation. Publishing requires
the owner's explicit approval of the concrete source package and destination repo.

The marketplace publishing guide requires a public GitHub repository, a root
manifest, README/license, and safe installation/removal. Its validation checks
listings, not plugin security: https://plugins.omarchy.org/publish.html . Plugins
run with user permissions: https://plugins.omarchy.org/develop.html .

Release package:

- Root manifest points to plugin/h3man.jarvis/BarWidget.qml.
- Full backend and native plugin are included; first-run Open setup launches the
  local installer. Missing packages/models are never installed silently.
- Source allowlist excludes all personal runtime data and model weights.
- Existing user configuration, including intentional full-access settings, stays
  outside the release. New-user defaults are loopback-only and no public tunnel.
- MIT covers JARVIS source. Upstream model/runtime terms are documented separately.
- Uninstallation is explicit via jarvis uninstall; marketplace deletion alone
  cannot remove an independent systemd service. The README states this limitation.

Validation commands: node tests/onboarding.mjs; node tests/install.mjs;
node tests/theme.mjs; node tests/tailscale.mjs; node tests/integration.mjs;
node tests/theme-browser.mjs; omarchy plugin validate .; qmlformat parsing.

The review closes the identified token-disclosure, logging, default-exposure,
unprompted-download, and accidental-packaging issues. It does not certify that an
unsandboxed agent, its provider, third-party dependencies or models cannot disclose
secrets. Read PRIVACY.md and SECURITY.md before approving publication. The package
is a review candidate, not a security certification.


Completed checks for this candidate:

- Onboarding: detected configured and common-location models, reused without network,
  skipped without downloading, refused downloads without consent, verified checksums,
  and removed failed partial downloads. Noninteractive setup refuses to mutate config.
- Install/remove: clean temporary home with service/package managers mocked; private
  defaults, repeated install preserves config, uninstall preserves retained data.
- HTTPS/chat: no anonymous token disclosure, private credentials/directories, token
  absent from startup logs, authenticated history/chat/reset/stop and QR decode.
- Tailscale: persistent private Serve, stable URL, idempotence, existing-service and
  public-Funnel protections. Theme unit tests and live mobile-browser change test pass.
- Root and native plugin manifests validate; QML parses; changed shell/Node files parse.
- Source package compared with the local runtime token, key, session/history files:
  no exact runtime secret data or personal absolute home paths was found. No model,
  audio, environment file, credential file, log, screenshot or private config is packaged.

Your own full-access choice is not bundled. A repository destination and explicit
publication approval are still required before any upload or marketplace submission.
