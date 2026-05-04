#!/usr/bin/env bash
set -u

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT_DIR/.scratch"
APP_URL="${1:-http://10.0.0.158:5175/}"
STAMP="$(date +%Y%m%d-%H%M%S)"
REPORT="$OUT_DIR/mobile-terminal-iphone-validation-$STAMP.md"

mkdir -p "$OUT_DIR"

prompt_line() {
  local label="$1"
  local value
  read -r -p "$label: " value
  printf '%s' "$value"
}

record_check() {
  local title="$1"
  local expected="$2"
  local result
  local notes

  printf '\n%s\n' "$title"
  printf 'Expected: %s\n' "$expected"
  while true; do
    read -r -p "Result [pass/fail/skip]: " result
    case "$result" in
      pass|fail|skip) break ;;
      *) printf 'Use pass, fail, or skip.\n' ;;
    esac
  done
  read -r -p "Notes: " notes

  {
    printf '\n## %s\n\n' "$title"
    printf -- '- Result: %s\n' "$result"
    printf -- '- Expected: %s\n' "$expected"
    printf -- '- Notes: %s\n' "${notes:-none}"
  } >> "$REPORT"
}

cat > "$REPORT" <<EOF
# Mobile Terminal iPhone Validation Report

- App URL: $APP_URL
- Captured At: $(date -u +%Y-%m-%dT%H:%M:%SZ)
- Backend Restarted During Validation: no

## Device

- iPhone / iOS: $(prompt_line "iPhone model and iOS version")
- Safari or PWA mode: $(prompt_line "Safari or PWA mode")
- Reloaded before test: $(prompt_line "Reloaded before test? yes/no")

EOF

printf '\nOpen %s on the iPhone and use a live Codex session.\n' "$APP_URL"
printf 'This script only records results; it does not start, stop, or restart OpenCozy services.\n'

record_check "1. Tap input zone and type" "Keyboard opens, text enters the Codex prompt, and the terminal caret remains the editing signal."
record_check "2. Keyboard Return" "iOS Return submits without the floating Enter control."
record_check "3. Long wrapped prompt" "Long single-line prompt wraps visually, remains editable with a visible caret, and shows no extra visual space between the last typed character and cursor at wrap boundaries."
record_check "4. Spacebar caret movement" "Spacebar-trackpad moves the terminal cursor through the wrapped prompt."
record_check "5. Paste" "Pasted text appears through ordinary iOS input; no OpenCozy paste button appears."
record_check "6. Select and copy output/prompt/input" "Selection works across output, prompt text, and active input text; copied text is readable."
record_check "7. Streaming manual scroll" "Manual scroll during streaming pauses auto-scroll."
record_check "8. Selection during streaming" "Starting selection during streaming pauses auto-scroll and remains paused."
record_check "9. Return to bottom" "Down-chevron appears away from bottom and resumes follow-bottom when tapped."
record_check "10. Arrow pad while input is not focused" "Arrow/Enter controls appear on the right end immediately after native input is blurred or dismissed."
record_check "11. Picker/menu taps" "Non-input taps use terminal-native behavior when supported; otherwise contextual arrow/Enter fallback appears."
record_check "12. App settings" "Autocorrect and autocapitalization toggle independently and persist on this iPhone."

printf '\nReport written to %s\n' "$REPORT"
