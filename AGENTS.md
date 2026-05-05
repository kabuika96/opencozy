# OpenCozy Agents

## Agent skills

This repo is wired for the installed engineering skills. Do not copy or download the skills into this repository.

- `setup-matt-pocock-skills`: refreshes this repo's agent-skill documentation when tracker or domain-doc conventions change.
- `diagnose`: reproduces and narrows bugs before fixing them.
- `grill-with-docs`: clarifies product and domain decisions, then captures settled language in `CONTEXT.md` and ADRs.
- `improve-codebase-architecture`: finds refactoring opportunities that improve boundaries and testability.
- `tdd`: drives changes through a red-green-refactor loop.
- `to-issues`: breaks plans into local markdown issues under `.scratch/issues/`.
- `to-prd`: turns a settled plan into a product requirements document.
- `triage`: moves issues through the local triage vocabulary.
- `zoom-out`: explains unfamiliar code in broader system context.

## Project notes

OpenCozy is a secure PWA for running Codex from a phone. Keep the first version small: a Codex-only mobile terminal, saved app shortcuts, and trusted private access without becoming a general remote shell.

For frontend UX, follow `docs/ux-guide.md` and the interface direction in `CONTEXT.md`: mobile-native, terminal-adjacent, simple, and powerful through restraint. Use plain action rows, subtle separators, compact spacing, and direct labels. Avoid fake terminal prompt styling, green button/card treatments, repetitive explanatory copy, and marketing-like empty states.

## Backend restart rule

Always ask the user for explicit permission before restarting, stopping, killing, or otherwise replacing the backend process. This includes `npm run services:restart`, `./scripts/opencozy-services.sh restart`, backend LaunchAgent unload/kickstart operations, and killing backend Node processes.

Reason: the backend owns live Codex PTYs. Restarting it kills active OpenCozy/Codex sessions, can close browser WebSockets with `1006`, and can cause Codex to report `Conversation interrupted` after resume.

Frontend changes can update through Vite/HMR without this permission. Backend changes should be verified with tests first, then the agent should tell the user that a backend restart is needed and wait for approval before doing it.

When the approved restart request is coming through an OpenCozy-hosted Codex session, schedule the restart from a detached process so the backend can kill the current PTY without cancelling the restart:

```sh
tmux new-session -d -s opencozy-backend-restart 'cd /Users/openclaw/Documents/projects/opencozy && sleep 2 && npm run services:restart > /tmp/opencozy-backend-restart.log 2>&1'
```

After that, verify `/tmp/opencozy-backend-restart.log`, `curl -fsS http://127.0.0.1:8788/api/health`, `curl -fsS http://127.0.0.1:5175/`, and `./scripts/opencozy-services.sh status`. Do not issue a second restart just because the original session disconnected.

## Private WAN setup

For Tailscale-based Private WAN setup, follow [docs/private-wan-agent-setup.md](docs/private-wan-agent-setup.md). The key boundaries are: backend localhost-only, frontend as the single OpenCozy origin, explicit `OPENCOZY_ALLOWED_HOSTS`, HTTPS through Tailscale Serve, no Tailscale Funnel, and no direct backend exposure. OpenCozy Settings shows the current WAN Tunnel config and state once the backend has loaded the relevant `.env`.

During installation or setup, after local OpenCozy works, ask the user whether they want private WAN access through Tailscale Serve. If they agree, proceed with the WAN setup guide end to end; if they decline, leave WAN disabled and keep direct local/LAN access working.

Use `npm run lan:start` for direct local/LAN access. Use `npm run wan:start` when the user wants OpenCozy available through the local services and Tailscale; it starts local OpenCozy services and then enables Tailscale Serve. Use `npm run private-wan:stop` only when disabling the HTTPS tailnet origin while leaving local services running. Use `npm run wan:stop` only when the user explicitly asks to stop WAN OpenCozy as a whole; it disables Serve and stops the local OpenCozy services, so the backend restart/stop permission rule applies.
