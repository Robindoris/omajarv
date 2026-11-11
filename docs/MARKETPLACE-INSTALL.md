# Marketplace installation review

Omajarv (`h3man.jarvis`) needs two explicit steps: add/enable the bar plugin, then
run setup to install its launcher and independent systemd user service. The plugin
manager does not run `install.sh` automatically. Enabling the widget must not
silently install dependencies, download models or expose the bridge to a network.

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
maintainer controls the catalog and decides whether a two-step install qualifies.

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

3. Open **Assistant → Open setup**. Review the package, voice-model and optional
   network prompts. A package refusal stops that run; text-only setup is available:

   ```bash
   bash "$HOME/.config/omarchy/plugins/h3man.jarvis/install.sh" --no-plugin --no-packages --no-models
   ```

   This explicit setup installs the CLI and starts the user service. Fresh config
   uses loopback, public tunnels off and unrestricted agent access off. Global
   coding-agent instructions require their separate opt-in flag. Existing config,
   including intentional network/full-access settings, is preserved.
4. Run `jarvis status` and try native text chat. Add voice and phone access only
   when desired. Keep tokens, access links, QR images and logs private; do not put
   them in a marketplace report.
5. Finish active requests before updates. Keep the source directory while installed.
   After an upstream update, rerun setup when launcher/service/dependency changes
   require it. Source replacement alone does not restart an already running bridge;
   use `jarvis restart` after the conversation is idle. Do not mix an existing
   clone-based runtime with a second marketplace installation.
6. Remove with `jarvis uninstall` **before** generic marketplace removal. It stops
   and disables the independent service, retires owned phone forwarding, and removes
   the unit, launcher and plugin. Config, local history and downloaded models remain;
   remove retained data separately only if wanted. If setup never ran, use the
   plugin manager's removal command. Generic removal is not a service uninstaller.

## Validation and remaining gates

- [x] Validate the proposed source in a HEAD-based temporary snapshot containing
  only the install-readiness changes, excluding pending voice work.
- [x] Root and nested manifest validation; Bash/Node syntax; Qt 6 QML parsing.
- [x] Marketplace-layout regression: source survives setup, CLI/unit target that
  source, defaults stay private, no package/model/global-skill changes without opt-in,
  reruns preserve config, current setup source wins over an older CLI, removal leaves
  no dangling launcher. Test services, package managers and agents must be mocked.
- [x] Existing install, onboarding, authenticated bridge, privacy, phone forwarding
  and browser regressions. Exact results are recorded below.
- [x] Build the allowlisted source package and verify its manifest, all 80 file
  checksums and absence of runtime credentials, models, recordings and pending
  voice-auth files. No artifact was published.
- [ ] Clean disposable Omarchy session/VM smoke test: actual `plugin add --enable`,
  first panel open, terminal onboarding, text chat with an authorized test agent,
  idle update/restart, and uninstall. Automated fixture checks do not replace this
  live Quickshell/plugin-manager integration check. Do not test it by replacing a
  user's existing installation.
- [ ] Review the diff; commit only install-readiness changes. Publish the reviewed
  commit with explicit authorization, preserving pending unrelated work.
- [ ] Request a listing refresh on existing issue #12542 with the exact commit and
  test results. Do not open a duplicate submission. The maintainer must decide
  whether to offer the command with the mandatory setup note, or retain Manual setup.
- [ ] After maintainer approval, verify the live catalog fields, rendered command,
  setup note, current name and verification snapshot. Approval of a previous commit
  is not verification of a new one.

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

## Draft maintainer request — not submitted

> Please review Omajarv (`h3man.jarvis`) for displaying the standard repository-add
> command with an explicit two-step setup note. Proposed commit: **fill in after
> committing the reviewed changes**.
>
> Command: `omarchy plugin add https://github.com/Robindoris/omajarv.git --enable`
>
> Required note: “Adds and enables the reactor only. Open Assistant → Open setup
> to install the launcher and user service. Package/model downloads and phone
> networking require explicit choices. Run jarvis uninstall before removing the
> plugin; models, configuration and history are retained.”
>
> Setup now prefers the marketplace installer over an older launcher, and removal
> deletes its owned launcher before deleting the marketplace runtime source.
> Fresh defaults remain loopback-only, public tunnels and unrestricted agent
> access off; global coding-agent instructions require their separate opt-in.
>
> Include exact automated results and disposable-session smoke-test results here.
> Please refresh the displayed name to Omarchy Jarvis and review the new snapshot.
> If mandatory service onboarding excludes the standard install command under
> marketplace policy, please retain Manual setup and clarify that requirement.

This review covers the install lifecycle and the listed regression checks. It is
not an independent security audit of all agents, dependencies or provider behavior.
