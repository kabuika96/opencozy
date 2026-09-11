# Opencozy Agent Guide

Read `CONTEXT.md` before changing domain behavior. Read `docs/adr/` before changing architecture or integration boundaries.

## Agent skills

Use existing [domain docs](docs/agents/domain.md), [local issue conventions](docs/agents/issue-tracker.md), and [triage labels](docs/agents/triage-labels.md). Run setup only when needed configuration is missing; it is not a prerequisite for ordinary debugging or explanation.

- `setup-matt-pocock-skills`: Configure this repo's issue tracker, triage labels, and domain docs for the engineering skills.
- `diagnose`: Use disciplined reproduction, minimization, instrumentation, fix, and regression-test loops for bugs and regressions.
- `grill-with-docs`: Stress-test plans against domain language and update `CONTEXT.md` or ADRs as decisions crystallize.
- `improve-codebase-architecture`: Find refactoring and architecture improvements using the domain docs and ADRs.
- `tdd`: Use red-green-refactor for feature work or bug fixes that benefit from test-first development.
- `to-issues`: Break plans or PRDs into independently grabbable local markdown issues.
- `to-prd`: Turn a conversation or plan into a PRD and publish it to the project issue tracker.
- `triage`: Create, clarify, label, and move issues through the triage workflow.
- `zoom-out`: Reconstruct broader system context before working in unfamiliar code.

## Local Defaults

- Keep services localhost-only unless an ADR changes the trust boundary.
- Ask before restarting the Opencozy backend unless the user has already approved that pending restart. Browser reconnection now preserves tabs, drafts, history, and resumable Harness context, but it does not preserve in-flight execution: recovery marks interrupted Runs failed internally and returns their Threads to idle. Continuing requires a new Run; the agent performing the restart can also be interrupted.
- Present a pending restart as an explicit approval card through `liteharness.request_approval` when available, with the concrete change and the warning that active Runs stop. Wait for `approved: true` before scheduling or executing that one restart; No, cancellation, errors, and silence never approve it. Do not ask twice for an already-approved pending action. Full-access command execution may skip native shell approval even with `require_escalated`, so it is not a reliable substitute for this decision. Older Harness Threads may lack the new tool; ask plainly there. Do not use `request_user_input_async` as a UI fallback in this installation: it returned accepted without emitting an input/approval event, leaving only assistant text visible. Do not claim buttons are displayed merely because a tool returned accepted; verify the corresponding persisted approval event. Do not reset history to install tools.
- Do not treat a healthy restart, a recovered PWA, or passing prompt-cache checks as proof that active Runs continue. Remove the restart approval gate only after an isolated integration check proves the same in-flight Run and its tool/subagent work survive backend replacement without resubmission or lost control. Current evidence: [Run recovery](docs/adr/0005-backend-run-state-heartbeat.md), [reliability tests](backend/test/runReliability.test.ts), and [browser restart tests](frontend/e2e/restart.spec.ts).
- Never schedule a one-time service restart with `launchctl submit` or a KeepAlive job. A submitted restart job caused a repeating shutdown/reinstall loop on 2026-09-06. For an approved backend-only restart, use `launchctl kickstart -k gui/$(id -u)/com.liteharness.backend.dev` from outside the backend's process tree, then verify health and stable process IDs across multiple 10-second intervals.
- Use Tailscale Serve for trusted mobile access.
- Keep Harness SDK/protocol details inside backend adapters.
- Keep the mobile UI native-feeling and direct; avoid terminal input emulation.

## Verification and prompt changes

- Use `npm run check` for affected application changes and required workspace checks. `npm run test:prompt-cache` verifies request-prefix equality with an isolated local stub; it does not call a live model or restart this app.
- Keep stable Harness instructions separate from per-message content. Preserve persisted history; changing instruction sources does not authorize clearing or rewriting existing Threads.
- Distinguish saved code, installed skill files, and behavior loaded by a running backend. A completed restart approval covers that restart; ask before a later backend restart.
