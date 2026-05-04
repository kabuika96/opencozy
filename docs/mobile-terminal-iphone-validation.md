# Mobile Terminal iPhone Validation

The Mobile Terminal Surface spike is accepted only after it works on an actual iPhone against a live Codex session. Desktop browser emulation and automated unit tests are useful for iteration, but they do not prove iOS keyboard, caret, selection, paste, or touch behavior.

## Preconditions

- The frontend dev server is running and reachable from the iPhone on the LAN.
- The backend is already running. Do not restart or kill it without explicit permission, because that terminates active Codex PTYs.
- The iPhone and Mac are on the same network.
- A live Codex session is available to start or resume.

At the time this checklist was written, the app responded at `http://10.0.0.158:5175/`. Re-check the Mac's current LAN address if that URL stops loading.

## Acceptance Criteria

- [ ] Native-feeling typing works in the active Codex prompt.
- [ ] Keyboard Return submits by default.
- [ ] Long wrapped prompts remain editable with a visible caret.
- [ ] Long wrapped prompts do not show extra visual space between the last typed character and the cursor at wrap boundaries.
- [ ] Spacebar-trackpad caret movement works across wrapped visual lines.
- [ ] Selection and normalized copy work across output, prompts, and active input.
- [ ] Manual scroll and selection pause auto-scroll.
- [ ] The floating down-chevron appears whenever away from bottom and restores follow-bottom.
- [ ] Arrow/Enter controls remain visible across native keyboard focus states.
- [ ] Non-input taps and contextual arrow/Enter fallback behave correctly in Codex picker/menu flows.
- [ ] Per-device autocorrect and autocapitalization settings work on the iPhone.

## Current Evidence Map

Automated checks currently cover the code paths, not the iOS runtime behavior. `npm run check` passed after the latest interaction fixes, covering lint, unit tests, and production builds for the mobile xterm package, backend, and frontend.

- Typing, paste, Return, deletion, replacement, and native caret selection diffs are covered by `frontend/src/mobileInputBridge.test.ts`.
- Native input hit-area placement and custom input-selection highlight rectangles over terminal-rendered input rows, including exact wrap-boundary caret rows, are covered by `frontend/src/mobileInputGeometry.test.ts`.
- Per-device autocorrect and autocapitalization defaults and persistence are covered by `frontend/src/mobileTerminalPreferences.test.ts`.
- Normalized copy and paste text handling are covered by `frontend/src/terminalClipboard.test.ts`.
- Touch scrolling, tap forwarding, long-press selection callbacks, synthetic click suppression, and return-to-bottom scroll ownership are covered by `frontend/src/terminalTouchScroll.test.ts`.
- Native text-editing gestures are allowed through the app scroll lock in `frontend/src/outerScrollLock.test.ts`.
- Persistent arrow/Enter visibility is covered by `frontend/src/terminalControls.test.ts`.
- Terminal hit testing, tap forwarding, and buffer-range selection are covered by `packages/mobile-xterm/src/index.test.ts`.

The unchecked acceptance criteria above must stay unchecked until the same behavior is confirmed on a real iPhone against a live Codex session.

## Manual Script

To capture the manual run consistently, use:

```sh
bash scripts/hitl-mobile-terminal-validation.sh http://10.0.0.158:5175/
```

The helper only records pass/fail/skip notes into `.scratch/`; it does not start, stop, restart, or kill OpenCozy services.

1. Open OpenCozy on an actual iPhone in Safari.
2. Start or resume a live Codex session.
3. Tap the terminal input zone and type a short prompt.
   - Expected: keyboard opens, text enters the Codex prompt, and the visible terminal caret remains the editing signal.
4. Press the iOS keyboard Return key.
   - Expected: the prompt submits without needing the floating Enter control.
5. Type a long single-line prompt that wraps across multiple visual rows.
   - Expected: wrapped text remains editable, the caret stays visible, and no extra visual space appears between the last typed character and the cursor at wrap boundaries.
6. Long-press the iOS space bar and move the insertion point through the wrapped prompt.
   - Expected: the terminal cursor moves with the iOS caret gesture, including across wrapped visual rows.
7. Paste text from the iOS clipboard into the prompt.
   - Expected: pasted text appears as ordinary input; no OpenCozy paste button or confirmation appears.
8. Long-press and drag-select terminal output, prompt text, and active input text, then copy.
   - Expected: selection feels native enough for iPhone use, selected active input text has a visible highlight, and copied text is readable without terminal padding or line-ending artifacts.
9. Trigger streaming output, then manually scroll away from the bottom.
   - Expected: auto-scroll pauses and output no longer pulls the viewport down.
10. While output is streaming, start a text selection.
    - Expected: auto-scroll pauses and remains paused after selection ends.
11. Scroll away from bottom without streaming.
    - Expected: the floating down-chevron appears.
12. Tap the floating down-chevron.
    - Expected: the terminal returns to bottom and follow-bottom resumes.
13. Focus and blur the native input.
    - Expected: the arrow/Enter controls remain visible on the right end while the keyboard is open and after the input is blurred.
14. Enter a Codex picker/menu flow where terminal mouse tracking may or may not be active.
    - Expected: non-input taps use terminal-native behavior when supported; otherwise the arrow/Enter controls appear as fallback without explanatory text.
15. Open app settings and toggle autocorrect and autocapitalization independently.
    - Expected: each setting persists on that iPhone and does not affect another device.

## Failure Report

For each failed step, capture:

- iPhone model and iOS version.
- Safari or PWA install mode.
- Whether the keyboard was visible.
- What was expected.
- What actually happened.
- Whether a reload changed the behavior.

## Current iPhone Findings

- Output selection and copy worked on the real iPhone.
- Non-input taps caused the keyboard to appear and then disappear; this pointed to xterm's internal helper textarea receiving forwarded taps when no terminal mouse tracking was active.
- Spacebar-trackpad caret movement did not work; the gesture selected a larger outer page/app target instead of moving the prompt caret.
- Selecting active input text while typing, for example to remove part of the prompt, did not work.
- After the focus and scroll-lock fixes, basic typing improved, but tapping existing input text did not move the caret there and double-tapping input text did not enter native iOS word selection with expandable handles.
- After native input text selection began working, dragging the left selection handle made the right handle wiggle, and two cursors could appear at times.
- After selection behavior improved, the arrow controls were still not always available when input was out of focus, and a visible gap could appear between the last typed character and cursor at each wrapped input line.

Follow-up implemented after those findings:

- Non-input taps now skip xterm DOM forwarding when terminal mouse tracking is inactive, avoiding xterm helper-textarea focus.
- The iOS input bridge textarea is pointer-interactive only over the inferred active input text hit-area, so native input-zone selection and spacebar-trackpad gestures can target prompt text without taking over output selection.
- The app-level outer scroll lock now yields to native text-editing elements, so iOS textarea gestures such as text selection handles and spacebar-trackpad caret movement are not prevented by the page scroll guard.
- The terminal touch layer now prevents the browser's synthetic post-touch click after handled taps, reducing keyboard focus/blur flicker after input-zone taps and viewport reflow.
- The iOS input bridge textarea is now dynamically positioned over the inferred terminal-rendered input text rows, rather than the whole bottom input zone, and stays touch-interactive on that text so native taps, double-taps, and selection handles can target active input text.
- The native textarea keeps iOS's 16px input font size but is scaled to the terminal's 14px visual metrics, so tap hit testing, word selection, and selection expansion better align with the terminal-rendered prompt. Native text and the native caret stay transparent; the terminal-rendered cursor remains the visible editing signal.
- Range-only native selection changes no longer emit terminal cursor movement. This keeps iOS selection-handle drags local until the selection collapses or text changes, avoiding PTY cursor redraws that can move the opposite handle. The extra OpenCozy visual cursor is hidden while the native input bridge is focused to reduce duplicate cursor affordances.
- Active input selections now render an OpenCozy-owned highlight overlay from the native textarea selection range, so selected text remains visually highlighted even when iOS does not paint selection over transparent textarea text.
- The arrow/Enter pad now remains visible across native keyboard focus states, and non-input taps explicitly blur the native input before terminal tap handling. The native textarea caret is transparent again so wrapped input uses the terminal-rendered cursor as the only visible caret, avoiding browser/xterm caret mismatch at line wraps.
- The OpenCozy-owned visual cursor remains visible while the native input bridge is focused, and the xterm canvas cursor is transparent to avoid duplicate caret signals.
