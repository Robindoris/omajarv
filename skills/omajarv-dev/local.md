# Find the local installation

Resolve `readlink -f ~/.local/bin/jarvis` and inspect
`systemctl --user cat omarchy-jarvis.service` for the active source directory.
Do not print runtime credentials or access links. The repository origin should be
https://github.com/Robindoris/omajarv; inspect status before making changes.

The user plugin lives under `~/.config/omarchy/plugins/h3man.jarvis/`. It may contain
an entire source package or a legacy flat native panel. Inspect rather than assuming
its layout or overwriting it with a different checkout.

Only an explicit `--install-agent-skill` installer invocation copies this portable skill to `~/.agents/skills/omajarv-dev/`, the
shared skill location for the current user. It installs a real copy, so removing
or moving a source checkout does not leave a broken skill symlink. Different agent
products vary in shared skill discovery; an existing session may need to reload
skills or restart. The plugin does not silently change agent-specific settings.

Update the bundled `skills/omajarv-dev/` when product behavior changes. Installer
reruns with `--install-agent-skill` update the shared copy and preserve differing prior content in the JARVIS
state directory's skill-backups folder. Uninstall retains the shared skill and its
backups. Do not embed personal paths, preferences or private runtime state in the
bundled skill. Ordinary setup and native onboarding do not install or refresh it.
