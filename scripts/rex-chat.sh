#!/usr/bin/env bash
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
usage() { printf '%s\n' 'Usage: bash scripts/rex-chat.sh new | list | view SESSION | send SESSION TEXT | stop SESSION' >&2; exit 2; }
: "${XDG_RUNTIME_DIR:?Run from your local Linux user session}"
rex=(rex --autostart=false --server "unix://$XDG_RUNTIME_DIR/rex/server.sock")
check_session() { [[ $1 =~ ^jarvis2-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] || usage; }
case ${1:-} in
 new)
  [[ $# == 1 ]] || usage
  hermes=$(command -v hermes) || { printf 'Hermes is not on PATH.\n' >&2; exit 1; }
  read -r uuid </proc/sys/kernel/random/uuid
  session=jarvis2-$uuid
  "${rex[@]}" new --cwd "$root" --keep-open --shell none "$session" -- "$hermes" -p jarvis2 chat -s jarvis2-dev >/dev/null
  printf '%s\n' "$session"
  ;;
 list)
  [[ $# == 1 ]] || usage
  "${rex[@]}" ls --json | python3 -c 'import json,sys; print(*(s["label"] for s in json.load(sys.stdin)["sessions"] if (s.get("label") or "").startswith("jarvis2-")), sep="\n")'
  ;;
 view)
  [[ $# == 2 ]] || usage; check_session "$2"
  "${rex[@]}" capture --session "$2" --trim --unwrap | tail -n 60
  ;;
 send)
  [[ $# == 3 && -n $3 && ! $3 =~ [[:cntrl:]] ]] || usage; check_session "$2"
  printf '%s' "$3" | "${rex[@]}" send --session "$2"
  "${rex[@]}" send-key --session "$2" enter
  ;;
 stop)
  [[ $# == 2 ]] || usage; check_session "$2"
  "${rex[@]}" send-key --session "$2" ctrl+c
  ;;
 *) usage;;
esac
