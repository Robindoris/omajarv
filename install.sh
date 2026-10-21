#!/bin/bash
# JARVIS installer for Omarchy.
#
#   ./install.sh                 full install (packages, models, service, plugin)
#   ./install.sh --no-packages   skip pacman/AUR (already have whisper + piper)
#   ./install.sh --no-models     skip model downloads
#   ./install.sh --no-service    skip the systemd user service
#   ./install.sh --no-plugin     skip installing/enabling the bar widget
#   ./install.sh --uninstall     remove service, symlinks and plugin (keeps models)

set -euo pipefail
umask 077

ROOT=$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)
STATE_DIR="$HOME/.local/state/omarchy-jarvis"
CONFIG_DIR="$HOME/.config/omarchy-jarvis"
DATA_DIR="$HOME/.local/share/omarchy-jarvis"
WHISPER_DIR="$DATA_DIR/models/whisper"
PIPER_DIR="$DATA_DIR/models/piper"
BIN_DIR="$HOME/.local/bin"
PLUGIN_DIR="$HOME/.config/omarchy/plugins/h3man.jarvis"
UNIT_DIR="$HOME/.config/systemd/user"
UNIT="$UNIT_DIR/omarchy-jarvis.service"


do_packages=true
do_models=true
do_service=true
do_plugin=true
uninstall=false

for arg in "$@"; do
  case "$arg" in
    --no-packages) do_packages=false ;;
    --no-models) do_models=false ;;
    --no-service) do_service=false ;;
    --no-plugin) do_plugin=false ;;
    --uninstall) uninstall=true ;;
    -h | --help)
      sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 1
      ;;
  esac
done

say() { printf '\n\033[1;36m==>\033[0m \033[1m%s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m  !\033[0m %s\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }

need_sudo() {
  if ! sudo -n true 2>/dev/null; then
    echo "  sudo password needed for package installation."
  fi
}

# ---------------------------------------------------------------- uninstall

if $uninstall; then
  say "Removing JARVIS"
  systemctl --user disable --now omarchy-jarvis.service 2>/dev/null || true
  rm -f "$UNIT"
  systemctl --user daemon-reload 2>/dev/null || true
  omarchy plugin disable h3man.jarvis 2>/dev/null || true
  if [[ -f "$PLUGIN_DIR/manifest.json" ]] && [[ $(jq -r .id "$PLUGIN_DIR/manifest.json") == h3man.jarvis ]]; then rm -rf "$PLUGIN_DIR"; fi
  if [[ -L "$BIN_DIR/jarvis" ]] && [[ $(readlink -f "$BIN_DIR/jarvis") == "$ROOT/bin/jarvis" ]]; then rm -f "$BIN_DIR/jarvis"; fi
  say "Done. Models and config were kept:"
  echo "    $DATA_DIR"
  echo "    $CONFIG_DIR"
  exit 0
fi

# ------------------------------------------------------------------- checks

say "Checking the machine"
have node || { echo "Node.js 22+ is required (install nodejs before setup)." >&2; exit 1; }
node -e 'if (Number(process.versions.node.split(".")[0]) < 22) process.exit(1)' || { echo "Node.js 22+ is required" >&2; exit 1; }
have curl || { echo "curl is required" >&2; exit 1; }
have openssl || { echo "openssl is required" >&2; exit 1; }
have jq || { echo "jq is required" >&2; exit 1; }
NODE_BIN=$(command -v node)
echo "  node      $NODE_BIN ($(node --version))"
echo "  omarchy   $(omarchy version 2>/dev/null || echo unknown)"
DEFAULT_AGENT=$(cat "$HOME/.config/omarchy/defaults/agent" 2>/dev/null || true)
if [[ -n $DEFAULT_AGENT ]]; then
  echo "  agent     $DEFAULT_AGENT"
else
  warn "No Omarchy default agent set. Pick one with: omarchy default agent codex"
fi

mkdir -p "$STATE_DIR" "$CONFIG_DIR" "$DATA_DIR" "$WHISPER_DIR" "$PIPER_DIR" "$BIN_DIR" "$UNIT_DIR"

# ---------------------------------------------------------------- packages

if $do_packages; then
  say "Installing packages"
  if [[ ! -t 0 ]]; then echo "Package installation needs an interactive terminal; use --no-packages to skip." >&2; exit 1; fi
  read -r -p "Install missing packages using pacman/AUR? [y/N]: " package_consent
  if [[ ! $package_consent =~ ^[Yy]([Ee][Ss])?$ ]]; then echo "Package installation skipped; rerun with --no-packages."; exit 1; fi
  need_sudo
  PKGS=(whisper-cpp ffmpeg qrencode jq curl pipewire)
  MISSING=()
  for pkg in "${PKGS[@]}"; do
    pacman -Qq "$pkg" &>/dev/null || MISSING+=("$pkg")
  done
  if ((${#MISSING[@]})); then
    echo "  pacman: ${MISSING[*]}"
    sudo pacman -S --needed --noconfirm "${MISSING[@]}"
  else
    echo "  pacman packages already present"
  fi

  if ! have piper && ! have piper-tts; then
    if have yay; then
      echo "  AUR: piper-tts"
      yay -S --needed --noconfirm piper-tts || yay -S --needed --noconfirm piper-tts-bin
    else
      warn "yay not found - install piper yourself: yay -S piper-tts"
    fi
  else
    echo "  piper already present ($(command -v piper))"
  fi
else
  say "Skipping package installation"
fi

# ------------------------------------------------------------------ models
if $do_models; then
  say "Voice model onboarding"
  node "$ROOT/server/setup.mjs" --models
else
  say "Skipping model setup; text chat remains available"
fi

# ------------------------------------------------------------------ config

if [[ ! -f "$CONFIG_DIR/config.json" ]]; then
  say "Writing default config"
  node --input-type=module - "$ROOT" <<'JS'
import { pathToFileURL } from 'node:url';
const { writeDefaultConfig } = await import(pathToFileURL(process.argv[2] + '/server/lib/config.mjs'));
writeDefaultConfig();
JS
else
  echo "  config already exists"
fi
if [[ -t 0 ]]; then
  read -r -p "Review network access? [y/N]: " network_consent
  if [[ $network_consent =~ ^[Yy]([Ee][Ss])?$ ]]; then node "$ROOT/server/setup.mjs" --network; fi
fi
mkdir -p "$DATA_DIR/workspace"

# --------------------------------------------------------------------- CLI

say "Installing the jarvis command"
chmod +x "$ROOT/bin/jarvis" "$ROOT/server/jarvis-server.mjs"
if [[ -e "$BIN_DIR/jarvis" && ! -L "$BIN_DIR/jarvis" ]]; then echo "Refusing to overwrite an existing jarvis command" >&2; exit 1; fi
ln -sfn "$ROOT/bin/jarvis" "$BIN_DIR/jarvis"
echo "  $BIN_DIR/jarvis -> $ROOT/bin/jarvis"

# ----------------------------------------------------------------- service

if $do_service; then
  say "Installing the systemd user service"
  MISE_SHIMS="$HOME/.local/share/mise/shims"
  cat >"$UNIT" <<EOF
[Unit]
Description=JARVIS voice bridge (local STT/TTS + Omarchy agent)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory="$ROOT"
ExecStart="$NODE_BIN" "$ROOT/server/jarvis-server.mjs"
Environment=PATH=$HOME/.local/bin:$MISE_SHIMS:/usr/local/bin:/usr/bin
Environment=NODE_ENV=production
UMask=0077
Restart=on-failure
RestartSec=3
KillMode=mixed
TimeoutStopSec=8

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable --now omarchy-jarvis.service
  sleep 2
  if systemctl --user is-active --quiet omarchy-jarvis.service; then
    echo "  service is running"
  else
    warn "service did not start; recent log:"
    journalctl --user -u omarchy-jarvis.service -n 15 --no-pager || true
  fi
else
  say "Skipping the service"
fi

# ------------------------------------------------------------------ plugin

if $do_plugin; then
  say "Installing the Omarchy bar plugin"
  mkdir -p "$(dirname "$PLUGIN_DIR")"
  if [[ $(readlink -m "$ROOT") != $(readlink -m "$PLUGIN_DIR") ]]; then
    if [[ -d $PLUGIN_DIR ]] && [[ -n $(ls -A "$PLUGIN_DIR") ]]; then
      plugin_backup="$HOME/.local/state/omarchy-jarvis/plugin-backup-$(date +%s)"
      mv "$PLUGIN_DIR" "$plugin_backup"
      echo "  Existing plugin backed up to $plugin_backup"
    fi
    node "$ROOT/scripts/build-release.mjs" "$PLUGIN_DIR"
  fi
  omarchy plugin validate "$PLUGIN_DIR" >/dev/null
  echo "  $PLUGIN_DIR"
  if omarchy plugin enable h3man.jarvis --section right --before omarchy.power 2>/dev/null; then
    echo "  enabled in the right bar section"
  else
    warn "Could not place the widget automatically. Add it with: omarchy plugin enable h3man.jarvis --section right"
  fi
  omarchy restart shell 2>/dev/null || true
fi

# -------------------------------------------------------------------- done

say "Ready"
echo "  Public Cloudflare access is opt-in. Reconfigure with: jarvis setup"
touch "$STATE_DIR/installed.ok"
"$BIN_DIR/jarvis" status || true
echo "Open JARVIS in the bar. Choose Phone after configuring LAN, Tailscale, or Cloudflare access."
