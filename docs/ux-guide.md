# OpenCozy UX Guide

OpenCozy should feel mobile-native and terminal-adjacent, but it should not cosplay as a terminal. The UI should feel powerful through restraint: plain structure, direct labels, low visual noise, and controls that look inevitable rather than decorated.

## Core Direction

- Use restrained surfaces, neutral translucency, subtle blur, and thin separators.
- Prefer text-first controls with clear labels. Use icons for compact tool buttons, not for routine actions like saving.
- Keep copy short and contextual. Do not repeat the app name or explain obvious mechanics.
- Avoid fake terminal styling: no decorative `$` prompts, green button treatments, faux command rows, or terminal-themed gimmicks.
- Avoid card-like option buttons, marketing-style empty states, heavy shadows, and one-off green accents.

## Pages

- Major workflows such as Settings and Preview should be full-screen pages, not small popovers.
- Page titles belong in the header. The body should start below the header and flow naturally from short context into controls.
- Content should be top-weighted and left-aligned with normal mobile page margins. Do not center page content by default.
- Use a constrained readable width when useful, but do not create a large left gutter or modal-like centered column.
- Page headers may use a subtle blurred backing for readability. Keep title left and close/actions right.
- Settings should lead with user-meaningful state and keep raw diagnostics collapsed or secondary. For access/network settings, show whether LAN/WAN are usable before exposing socket paths, host allowlists, or Serve output.

## Rows And Actions

- Prefer plain action rows with dividers over boxed buttons.
- Rows should have enough height for mobile tapping, generally around 50-54px.
- Use chevrons for navigation/action rows when they clarify direction.
- Primary actions should be text-first: `Save URL`, `Save Title`, `Copy Message`.
- Destructive actions should be restrained, usually text color only. Avoid heavy danger cards unless the risk requires escalation.

## Tabs And Floating Controls

- Session tabs should be text-first, not filled chips. Use a subtle active underline and muted close controls.
- Tab and toolbar readability can come from a slight blurred backing, not from individual card-like buttons.
- Floating controls should be grouped only when it improves readability or tap safety. Use neutral translucent backing and subtle active states.
- Avoid green-tinted control chrome unless the green comes from terminal content itself.

## Prompts, Modals, And Forms

- Confirmation prompts should be compact neutral surfaces with a clear title, one line of context, and plain action rows.
- Forms should use transparent inputs with neutral borders and direct labels.
- Modal sheets, menus, and confirmation prompts should blur only their own surface background, with enough dark opacity to hold text over terminal output. Do not blur the whole app behind a menu just to improve readability.
- Helper copy should explain when to use an affordance. For example, Preview copy should tell the user to paste the copied message to their agent if they do not know how to connect.

## Empty States

- Empty states should be task-oriented, not promotional.
- Lead with the current workflow, then present the next actions as simple rows.
- Use app identity sparingly. The owl icon and OpenCozy name can appear in navigation or the start tab, but main task screens should prioritize the workflow.
