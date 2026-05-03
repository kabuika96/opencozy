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

OpenCozy is a local-first PWA. Keep the first version small: a Codex-only remote terminal and saved LAN app shortcuts.

## Backend restart rule

Always ask the user for explicit permission before restarting, stopping, killing, or otherwise replacing the backend process. This includes `npm run services:restart`, `./scripts/opencozy-services.sh restart`, backend LaunchAgent unload/kickstart operations, and killing backend Node processes.

Reason: the backend owns live Codex PTYs. Restarting it kills active OpenCozy/Codex sessions, can close browser WebSockets with `1006`, and can cause Codex to report `Conversation interrupted` after resume.

Frontend changes can update through Vite/HMR without this permission. Backend changes should be verified with tests first, then the agent should tell the user that a backend restart is needed and wait for approval before doing it.
