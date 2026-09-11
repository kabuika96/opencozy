#!/bin/zsh
set -u

service="${1:-}"
script_dir="${0:A:h}"
root="$(cd "$script_dir/.." && pwd -P)"
home_dir="${HOME:?HOME is required}"
log_dir="${LITEHARNESS_SERVICE_LOG_DIR:-$home_dir/Library/Logs/LiteHarness}"

export PATH="$home_dir/.npm-global/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

timestamp() {
  date "+%Y-%m-%dT%H:%M:%S%z"
}

load_env() {
  local env_file="$root/.env"
  [[ -f "$env_file" ]] || return 0
  set -a
  source "$env_file"
  set +a
}

case "$service" in
  backend|frontend)
    ;;
  *)
    echo "[$(timestamp)] unknown Opencozy service: ${service:-<missing>}" >&2
    exit 64
    ;;
esac

mkdir -p "$log_dir"
cd "$root" || exit 70
load_env

child_pid=""

stop_child() {
  local signal="${1:-TERM}"
  if [[ -n "$child_pid" ]]; then
    echo "[$(timestamp)] liteharness-$service stopping child pid=$child_pid signal=$signal"
    kill "-$signal" "$child_pid" 2>/dev/null || true
    wait "$child_pid" 2>/dev/null || true
  fi
}

handle_signal() {
  local signal="$1"
  echo "[$(timestamp)] liteharness-$service received $signal"
  stop_child TERM
  echo "[$(timestamp)] liteharness-$service stopped after $signal"
  exit 0
}

trap 'handle_signal INT' INT
trap 'handle_signal TERM' TERM

echo "[$(timestamp)] liteharness-$service starting supervisor pid=$$ root=$root"
npm run dev --workspace "@opencozy/$service" &
child_pid="$!"
echo "[$(timestamp)] liteharness-$service child pid=$child_pid"

wait "$child_pid"
status="$?"
echo "[$(timestamp)] liteharness-$service child exited status=$status"
exit "$status"
