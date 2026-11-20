#!/bin/bash
set -euo pipefail
umask 077
repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
if [[ $(git -C "$repo" branch --show-current) != jarvis-2.0 ]]; then
  printf '%s\n' 'Run this from the Jarvis 2.0 checkout on branch jarvis-2.0.' >&2
  exit 1
fi
command -v omarchy >/dev/null
runner="$HOME/.local/bin/jarvis-daily"
config="$HOME/.config/jarvis-daily"
units="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
install -d -- "$HOME/.local/bin" "$config" "$units"
# Copy reviewed files rather than executing repository code from a timer.
install -m 700 -- "$repo/scripts/jarvis-daily.py" "$runner"
printf '%s\n' "$repo" > "$config/repo"
install -m 644 -t "$units" -- "$repo/systemd/jarvis-daily-evening.timer" "$repo/systemd/jarvis-daily-evening.service"
systemd-analyze --user verify "$units/jarvis-daily-evening.timer" "$units/jarvis-daily-evening.service"
omarchy hook install post-boot "$repo/scripts/jarvis-daily-morning"
systemctl --user daemon-reload
systemctl --user enable --now jarvis-daily-evening.timer
