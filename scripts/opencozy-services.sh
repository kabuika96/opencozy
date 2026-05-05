#!/bin/zsh
set -u

uid="$(id -u)"
domain="gui/$uid"
script_dir="${0:A:h}"
root="$(cd "$script_dir/.." && pwd -P)"
home_dir="${HOME:?HOME is required}"
agent_dir="$home_dir/Library/LaunchAgents"
log_dir="${OPENCOZY_SERVICE_LOG_DIR:-$home_dir/Library/Logs/OpenCozy}"
service_path="$home_dir/.npm-global/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
labels=("com.opencozy.backend.dev" "com.opencozy.frontend.dev")

usage() {
  echo "Usage: $0 {install|start|stop|restart|status|logs}"
}

plist_for_label() {
  echo "$agent_dir/$1.plist"
}

service_for_label() {
  case "$1" in
    com.opencozy.backend.dev)
      echo "backend"
      ;;
    com.opencozy.frontend.dev)
      echo "frontend"
      ;;
    *)
      return 64
      ;;
  esac
}

configured_port_for_service() {
  case "$1" in
    backend)
      configured_value "OPENCOZY_PORT" "8788"
      ;;
    frontend)
      configured_value "OPENCOZY_FRONTEND_PORT" "5175"
      ;;
    *)
      return 64
      ;;
  esac
}

configured_value() {
  local key="$1"
  local fallback="$2"
  local file_value=""

  if (( ${+parameters[$key]} )); then
    echo "${(P)key}"
    return
  fi

  if [[ -f "$root/.env" ]]; then
    file_value="$(awk -F= -v key="$key" '
      /^[[:space:]]*#/ || /^[[:space:]]*$/ { next }
      {
        name = $1
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", name)
        if (name == key) {
          sub(/^[^=]*=/, "", $0)
          gsub(/^[[:space:]]+|[[:space:]]+$/, "", $0)
          gsub(/^"/, "", $0)
          gsub(/"$/, "", $0)
          gsub(/^'\''/, "", $0)
          gsub(/'\''$/, "", $0)
          print $0
          exit
        }
      }
    ' "$root/.env")"
  fi

  echo "${file_value:-$fallback}"
}

port_listeners() {
  local port="$1"
  lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | awk 'NR > 1 { print $1 " pid " $2 " " $9 }'
}

ensure_no_unmanaged_port_listeners() {
  local busy=0
  local label service port listeners

  for label in "${labels[@]}"; do
    if launchctl print "$domain/$label" >/dev/null 2>&1; then
      continue
    fi

    service="$(service_for_label "$label")" || return 64
    port="$(configured_port_for_service "$service")" || return 64
    listeners="$(port_listeners "$port")"

    if [[ -n "$listeners" ]]; then
      echo "Port $port for OpenCozy $service is already in use:"
      for listener in ${(f)listeners}; do
        echo "  $listener"
      done
      busy=1
    fi
  done

  if [[ "$busy" -ne 0 ]]; then
    echo "Stop the foreground npm run dev process before starting launchd services."
    return 75
  fi
}

write_plist() {
  local label="$1"
  local service
  service="$(service_for_label "$label")" || return 64
  local plist
  plist="$(plist_for_label "$label")"

  mkdir -p "$agent_dir" "$log_dir"

  cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$label</string>
  <key>ProgramArguments</key>
  <array>
    <string>$root/scripts/opencozy-service-runner.sh</string>
    <string>$service</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$root</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>OPENCOZY_SERVICE_LOG_DIR</key>
    <string>$log_dir</string>
    <key>PATH</key>
    <string>$service_path</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>$log_dir/$service.out.log</string>
  <key>StandardErrorPath</key>
  <string>$log_dir/$service.err.log</string>
</dict>
</plist>
PLIST

  plutil -lint "$plist" >/dev/null
}

install_plists() {
  for label in "${labels[@]}"; do
    write_plist "$label"
  done
}

start_service() {
  local label="$1"
  local plist
  plist="$(plist_for_label "$label")"
  if launchctl print "$domain/$label" >/dev/null 2>&1; then
    echo "$label already loaded"
    return
  fi
  if ! launchctl bootstrap "$domain" "$plist"; then
    sleep 1
    if launchctl print "$domain/$label" >/dev/null 2>&1; then
      launchctl kickstart -k "$domain/$label"
      return
    fi
    return 1
  fi
}

stop_service() {
  local label="$1"
  if launchctl print "$domain/$label" >/dev/null 2>&1; then
    launchctl bootout "$domain/$label" || launchctl bootout "$domain" "$(plist_for_label "$label")" || true
  fi
}

mkdir -p "$agent_dir" "$log_dir"

case "${1:-}" in
  install)
    install_plists
    echo "Installed OpenCozy LaunchAgents in $agent_dir"
    ;;
  start)
    ensure_no_unmanaged_port_listeners || exit $?
    install_plists
    for label in "${labels[@]}"; do
      start_service "$label"
    done
    ;;
  stop)
    for label in "${labels[@]}"; do
      stop_service "$label"
    done
    ;;
  restart)
    for label in "${labels[@]}"; do
      stop_service "$label"
    done
    sleep 1
    ensure_no_unmanaged_port_listeners || exit $?
    install_plists
    for label in "${labels[@]}"; do
      start_service "$label"
    done
    ;;
  status)
    for label in "${labels[@]}"; do
      echo "== $label =="
      launchctl print "$domain/$label" 2>/dev/null || echo "not loaded"
    done
    for label in "${labels[@]}"; do
      service="$(service_for_label "$label")" || exit 64
      port="$(configured_port_for_service "$service")" || exit 64
      listeners="$(port_listeners "$port")"
      if [[ -n "$listeners" ]]; then
        echo "== listeners on $port ($service) =="
        for listener in ${(f)listeners}; do
          echo "$listener"
        done
      fi
    done
    ;;
  logs)
    tail -n 120 -f "$log_dir/backend.out.log" "$log_dir/backend.err.log" "$log_dir/frontend.out.log" "$log_dir/frontend.err.log"
    ;;
  *)
    usage
    exit 64
    ;;
esac
