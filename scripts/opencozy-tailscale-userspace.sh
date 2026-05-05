#!/bin/zsh
set -u

uid="$(id -u)"
domain="gui/$uid"
label="com.opencozy.tailscaled.userspace"
script_dir="${0:A:h}"
root="$(cd "$script_dir/.." && pwd -P)"
home_dir="${HOME:?HOME is required}"
agent_dir="$home_dir/Library/LaunchAgents"
plist="$agent_dir/$label.plist"

configured_value() {
  local key="$1"
  local fallback="$2"
  local file_value=""

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

  if [[ -n "$file_value" ]]; then
    echo "$file_value"
  elif (( ${+parameters[$key]} )); then
    echo "${(P)key}"
  else
    echo "$fallback"
  fi
}

log_dir="$(configured_value "OPENCOZY_TAILSCALE_LOG_DIR" "$home_dir/Library/Logs/OpenCozy")"
state_dir="$(configured_value "OPENCOZY_TAILSCALE_STATE_DIR" "$home_dir/.local/share/opencozy-tailscale")"
socket_path="$(configured_value "OPENCOZY_TAILSCALE_SOCKET" "$state_dir/tailscaled.sock")"
tailscaled_bin="$(configured_value "OPENCOZY_TAILSCALED_BIN" "/usr/local/opt/tailscale/bin/tailscaled")"

usage() {
  echo "Usage: $0 {install|start|stop|restart|status|logs}"
}

write_plist() {
  mkdir -p "$agent_dir" "$log_dir" "$state_dir"

  cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$label</string>
  <key>ProgramArguments</key>
  <array>
    <string>$tailscaled_bin</string>
    <string>--tun=userspace-networking</string>
    <string>--socket=$socket_path</string>
    <string>--statedir=$state_dir</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>$log_dir/tailscaled.out.log</string>
  <key>StandardErrorPath</key>
  <string>$log_dir/tailscaled.err.log</string>
</dict>
</plist>
PLIST

  plutil -lint "$plist" >/dev/null
}

start_service() {
  write_plist
  if launchctl print "$domain/$label" >/dev/null 2>&1; then
    launchctl kickstart -k "$domain/$label"
    return
  fi

  launchctl bootstrap "$domain" "$plist"
}

stop_service() {
  if launchctl print "$domain/$label" >/dev/null 2>&1; then
    launchctl bootout "$domain/$label" || launchctl bootout "$domain" "$plist" || true
  fi
}

case "${1:-}" in
  install)
    write_plist
    echo "Installed $label in $plist"
    ;;
  start)
    start_service
    ;;
  stop)
    stop_service
    ;;
  restart)
    stop_service
    sleep 1
    start_service
    ;;
  status)
    launchctl print "$domain/$label" 2>/dev/null || echo "not loaded"
    ;;
  logs)
    tail -n 120 -f "$log_dir/tailscaled.out.log" "$log_dir/tailscaled.err.log"
    ;;
  *)
    usage
    exit 64
    ;;
esac
