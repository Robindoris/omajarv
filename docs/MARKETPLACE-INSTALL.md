# Marketplace installation review

The root plugin includes the launcher and starts the local bridge when the
panel opens. A configured Omarchy agent provides text chat. Setup is optional
for a persistent service, voice models, and remote phone access.

## Current listing

Checked 11 November 2026 in the public marketplace catalog:

- Repository layout: `root-plugin`; upstream compatibility: `passed`.
- Reviewed/listed snapshot: `ada675218cc1261c54932a2c1a14028be87aac86`.
- `installAvailable: false`, `installCommand: ""`, status `Manual setup`.
- The maintainer explicitly required manual setup for the launcher/user service.
- Visible project naming was subsequently updated in `8633efe`.

Sources: [listing](https://plugins.omarchy.org/plugin.html?id=h3man.jarvis),
[catalog](https://plugins.omarchy.org/catalog.json),
[maintainer review](https://github.com/omacom/omarchy-plugin-marketplace/issues/12542#issuecomment-6801194787),
[publishing guide](https://plugins.omarchy.org/publish.html).

The website's `marketplaceInstallAvailable()` requires `installAvailable` and an
upstream status other than `failed`; it renders the catalog's `installCommand`.
A README or upstream manifest change cannot switch this on. The marketplace
maintainer controls the catalog and decides whether to approve standard installation.

## User installation steps

1. Review the repository and privacy/security documentation. Use Omarchy Quattro,
   Node.js 22+, curl, jq and OpenSSL. Configure/sign in to a supported coding agent
   separately. Local speech does not make that agent's provider local.
2. On a fresh installation, run:

   ```bash
   omarchy plugin add https://github.com/Robindoris/omajarv.git --enable
   ```

   Omarchy clones current HEAD, validates the root manifest, adds the source under
   `~/.config/omarchy/plugins/h3man.jarvis/` and enables the reactor. This is not a
   commit-pinned install. Check the installed commit against the listing snapshot:

   ```bash
   git -C "$HOME/.config/omarchy/plugins/h3man.jarvis" rev-parse HEAD
   ```

3. Open the reactor and send a message from **Assistant**. Use **Open setup**
   for optional features. A clean install listens on loopback.
4. Stop the bridge from the panel before removing the marketplace checkout.
   If you installed the optional service, run `jarvis uninstall` first.

## Marketplace review

Request verification for the exact upstream commit. Once listed, the separate
standard-installation request requires a passing baseline or a matching
installer-only review and a maintainer's standard-installation approval.

## Automated results — 11 November 2026

Passed on the isolated proposed source:

- `node tests/marketplace-install.mjs` (also rejects unattended package setup before
  launcher/service/config creation).
- `node tests/install.mjs`, `node tests/onboarding.mjs`.
- `node tests/integration.mjs`, `node tests/local-privacy.mjs`,
  `node tests/privacy-audit.mjs`.
- `node tests/serve-socket.mjs`, `node tests/tailscale.mjs`,
  `node tests/tunnel.mjs`, `node tests/open-link.mjs`, `node tests/sudo.mjs`.
- `node tests/theme-browser.mjs` with fake providers and mobile-width fixtures.
- Both manifest validations, `bash -n install.sh`, new test syntax, Qt 6
  `qmlformat` parsing and `git diff --check`.

The installed Omarchy `omarchy-plugin-add` script was additionally exercised with
its canonical HTTPS argument redirected to a local Git fixture. Real URL and
manifest validation ran; catalog discovery, rescan and enable were mocked. It
cloned the root-plugin layout and requested enabling without running setup,
creating runtime config or starting a service. This does not test live shell
rendering or the remote GitHub transport.

The first privacy run found two existing plain-text declarations beyond its
75-character assertion window. Moving those declarations first, consistently
with other native labels, made the unchanged privacy assertion pass. The generic
`qmlformat` binary on the test host could not parse this Qt 6 source; the Qt 6
formatter succeeded. Neither was an unresolved security finding.

No real provider requests, package installations, model downloads, phone tunnel
connections, user service changes or live desktop replacement were used. The
remaining disposable-session GUI test and marketplace approval are still required
before describing this as a verified one-command marketplace install.
