# Opencozy

Opencozy is a mobile-first Codex control plane. It exposes a light PWA for driving Codex through its documented app-server protocol.

## Requirements

- Node.js 24 and npm. The backend uses Node's built-in SQLite.
- A Codex account/session with access to the configured execution models. The pinned `@openai/codex` dependency is installed by `npm ci`; authenticate it with `npx codex login` before starting real Runs.
- macOS for the optional launchd service scripts. Foreground development and CI do not require launchd.
- Tailscale only for private mobile access and published project previews.

The execution profiles currently select `gpt-6-astra`; model availability depends on your account. Review `backend/src/profiles/executionProfiles.ts` before using an account that lacks that model. Mock mode can be used to explore the UI without a model session.

## Quick start

```bash
git clone https://github.com/kabuika96/opencozy.git
cd opencozy
npm ci
cp .env.example .env
npx codex login
npm run dev
```

Open `http://127.0.0.1:5173`. Keep credentials and local data out of Git. Configuration examples use the retained `LITEHARNESS_*` environment names; see [rename compatibility](docs/adr/0023-opencozy-public-release.md).

For a UI-only smoke test, set `LITEHARNESS_CODEX_MODE=mock` in `.env` before starting. The optional OpenWrite and Hermes integrations are not required for basic use.

## Development

Install dependencies:

```bash
npm ci
```

Run the local services in the foreground:

```bash
npm run dev
```

The backend does not watch-restart by default because an in-flight Harness Run is owned by the current backend process. Restarting interrupts that Run but preserves its Thread, history, and Harness context. Tabs reconnect automatically and become ready for another message once the previous backend has exited. If its owner cannot be identified, recovery waits for the 60-second lease to expire; websocket heartbeats keep the tab's status current throughout recovery. Use backend watch mode only when no Runs are active:

```bash
npm run dev:watch --workspace @opencozy/backend
```

Default local URLs:

- Frontend: `http://127.0.0.1:5173`
- Backend health: `http://127.0.0.1:8787/api/health`

The backend binds to localhost by default. Publish the frontend to trusted devices with Tailscale Serve rather than exposing the backend directly.

If the default ports are occupied, override them for a single run:

```bash
LITEHARNESS_FRONTEND_PORT=5183 LITEHARNESS_BACKEND_PORT=8797 npm run dev
```

For durable local services:

```bash
npm run services:start
npm run services:status
```

For an approved backend-only restart, run `launchctl kickstart -k gui/$(id -u)/com.liteharness.backend.dev` from a separate terminal or agent outside Opencozy. This reuses the registered service and leaves the frontend running. Backend restarts interrupt active Runs; their Threads and history remain available.

Do not use `launchctl submit` or a KeepAlive job for a one-time restart. On 2026-09-06, a submitted temporary restart script was kept alive after successful exits and restarted both services roughly every 10 seconds. Its repeated service removal and registration coincided with macOS “Background Items Added” notifications. Removing that temporary job stopped the loop. Verify a restart by checking both health and unchanged service process IDs over at least 30 seconds.

For Private WAN access through a Opencozy-owned Tailscale userspace node:

```bash
npm run tailscale-userspace:start
tailscale --socket="$HOME/.local/share/liteharness-tailscale/tailscaled.sock" up --hostname=opencozy
npm run wan:start
```

Use `wan:start` when Opencozy should be available through local services and enrolled Tailscale devices. It starts the local Opencozy services and enables Tailscale Serve on the Opencozy Tailscale socket. Use `private-wan:stop` to disable only the tailnet HTTPS origin, or `wan:stop` to disable the tailnet origin and stop local Opencozy services together.

The old `scripts/tailscale-serve.sh` wrapper now delegates to `npm run private-wan:serve`.

Do not run `npm run dev` and `npm run services:start` at the same time. Stop the foreground dev runner before enabling durable services, or the configured ports will already be occupied.

Private WAN safety rules:

- Keep `LITEHARNESS_BACKEND_HOST=127.0.0.1`.
- Serve the frontend as the single Opencozy origin.
- Put Tailscale Serve in front of that frontend origin with HTTPS.
- Set `LITEHARNESS_ALLOWED_HOSTS` to the exact browser hostnames you will use.
- Do not use Tailscale Funnel or a public tunnel for Opencozy.

## Codex Harness Mode

By default, `LITEHARNESS_CODEX_MODE=app-server` keeps a Codex app-server process warm and reuses it across Runs. This path supports streaming, steering, approvals, input requests, and subagent activity without exposing Codex protocol details to the PWA. Use `LITEHARNESS_CODEX_MODE=mock` only for UI/backend smoke tests.

Follow-ups append new input to the same Codex history. The pool prefers an idle connection with that thread already loaded, and unchanged warm threads start the next turn without resuming again. Recovery resumes persisted history by id. Opencozy never rebuilds earlier model messages from the visible Timeline.

`npm run test:prompt-cache` checks exact request-prefix equality using the installed Codex binary and a localhost Responses stub, including recovery through a fresh probe process. It does not call a live model or restart Opencozy.

`npm run test:writer-isolation` checks that two Threads and their follow-ups run concurrently using separate owning Codex processes against a localhost Responses stub. It makes no live model calls and does not restart Opencozy.

New tabs and existing Thread settings offer only **Balance**, **Speed**, and **Power**. Every main agent and subagent uses `gpt-6-astra`:

| Profile | Main reasoning | Subagent reasoning | Default Fast mode |
| --- | --- | --- | --- |
| Balance (default) | high | high | On |
| Speed | medium | low | On |
| Power | max | xhigh | Off |

The backend uses the same profile definitions for displayed settings, new and resumed Runs, and all subagent roles, including nested work. Delegation still follows session policy and tool/model restrictions. Retired `astra` selections resolve to Balance without rewriting history; saved Fast preferences remain per Thread.

Model and effort environment settings apply only to utility model calls. They cannot override these profiles; obsolete `LITEHARNESS_CODEX_MODEL` and `LITEHARNESS_CODEX_REASONING_EFFORT` overrides are ignored.

## Approval cards

Agents can ask permission through `liteharness.request_approval({ action })`. The app shows **Yes** and **No** buttons, waits for the decision, and returns it to the agent. Approval authorizes only the described action once; the tool does not execute it. Backend restarts still interrupt active Runs.

`npm run test:action-approval` checks tool registration and Yes/No delivery using the pinned Codex runtime and a localhost model stub; it makes no live model calls or restarts.

The tool is installed on new Harness Threads after the backend update is loaded. Existing Threads retain history and their original tool definitions; agents ask plainly there. `request_user_input_async` is not connected to Opencozy approval cards in this installation. Native shell escalation can skip approval in full-access mode and is not a substitute.

## WhatsApp Messaging

Codex Threads created by Opencozy receive one outbound-only native tool:

```text
whatsapp.send_message({ message })
```

The recipient is not a tool argument. Configure the fixed owner chat and the local Hermes bridge port:

```bash
LITEHARNESS_WHATSAPP_CHAT_ID=your-owner-chat@lid
LITEHARNESS_WHATSAPP_BRIDGE_PORT=3000
```

The backend checks the loopback bridge health before each send and returns pairing, offline, and send failures to Codex. Run `hermes whatsapp` when the Hermes session needs pairing. Threads created with the tool retain it when Codex resumes them; older Codex Threads need a Context Compaction or a new Opencozy Thread to establish a tool-enabled Harness Thread.

## Event Presentation

Opencozy projects normalized Codex events into compact mobile summaries synchronously before storing them. Event streaming never waits on a second model call. Full app-server items are not duplicated into timeline payloads.

The native React shell keeps agent navigation and the composer reachable while the Timeline scrolls. Streaming follows the end only when you are already there; each Thread and agent keeps its reading position and draft. Long transcripts initially render the latest 100 entries, with earlier history available on demand.

## Tabs and Agents

Close an idle tab directly with its × control. Manage tabs supports search, close all idle tabs, close others, and Recently closed. Closing preserves the Thread and its history; Undo or Reopen restores it. **Stop work & close all** asks for confirmation and waits for cancellation; work that cannot be stopped stays open.

Agent navigation shows lineage, task, status, and activity. **Agent messages** exposes coordination instructions and delivery results. Select a running agent to send it a directed message; its draft and replies stay separate from Main. Finished agents remain readable, with follow-up work sent through Main.

## Verification

```bash
npm run check
npm run test:browser --workspace frontend
```

Browser tests start an isolated frontend on `127.0.0.1:5187` with mocked API and WebSocket traffic; they never submit real Harness Runs. Install their Chromium engine with `npm exec --workspace frontend -- playwright install chromium`. WebKit is a separate check:

```bash
npm exec --workspace frontend -- playwright install webkit
npm run test:browser:webkit --workspace frontend
```

The mobile browser suite covers tab recovery, agent messaging, scroll preservation, viewport resizing, keyboard dismissal, and confirmed stop-and-close. Actual iOS keyboard and safe-area behavior still need an on-device check. See `docs/audits/2026-09-06.md` for audit results and validation limits.

## Opencozy System Configs

Opencozy installs its mobile HTML reply contract as stable thread developer instructions. User prompts remain the stored, displayed, and dispatched input; the reply contract is not repeated in each message.

## Context Compaction

On request, Opencozy compacts older visible timeline history. It preserves the thread head and recent tail, stores a visible `thread.compacted` handoff event, hides summarized events from the primary timeline, and sends the latest handoff only through the hidden harness request. The stored user prompt remains unchanged.

Compaction is explicitly requested and may use the optional Opencozy Model. Sending a message never auto-compacts the visible Timeline or resets a healthy Codex thread. Codex retains ownership of its model context window and native compaction.

Useful overrides:

- `LITEHARNESS_COMPACTION_CONTEXT_TOKENS`
- `LITEHARNESS_COMPACTION_PROTECT_FIRST_EVENTS`
- `LITEHARNESS_COMPACTION_PROTECT_LAST_EVENTS`
- `LITEHARNESS_COMPACTION_TAIL_TOKENS`

## Project Preview

Project Preview stores reusable Wired Previews in the backend and attaches them to Threads. Use the Preview button in the mobile composer to attach a saved preview, approve a pending Preview Manifest, publish host-local targets through Tailscale Serve, or start a visible Preview Wiring Thread.

Useful overrides:

- `LITEHARNESS_TAILSCALE_BIN`
- `LITEHARNESS_TAILSCALE_SOCKET`
- `LITEHARNESS_PREVIEW_PUBLISH_PORT_START`
- `LITEHARNESS_PREVIEW_PUBLISH_PORT_END`
- `LITEHARNESS_PREVIEW_PROXY_PORT_START`
- `LITEHARNESS_PREVIEW_PROXY_PORT_END`

## Shared files

Ask Opencozy to share a local file to receive a persistent, tappable file card in chat. For example: “Share the report as a PDF,” then in a later chat: “Find my report and show it.” Explicitly shared files remain in the same Device library after their source chat is closed or deleted. Incoming message attachments remain separate unless the Harness publishes them.

Previews support plain text/code, static HTML, PDFs, images, and browser-supported audio/video. HTML previews disable scripts and remote resources. Search covers filenames, titles, descriptions, and available text/HTML/PDF content; images, recordings, and scanned PDFs have no OCR or transcription yet. Files are limited to 250 MiB, text previews to the first 4 MiB. File bytes and the search database live under `backend/data/assets`; include this directory in backups.

`npm run test:file-tools` verifies native publish/search/read/show calls with the pinned Codex runtime and a loopback model stub, without a live model call or service restart. See [ADR 0021](docs/adr/0021-durable-file-assets.md) for retention, indexing, and access details.

OpenWrite records use the same cards and viewer. Ask “Find my insurance record in OpenWrite and show it.” Opencozy searches the live records API and shares the chosen original as a checksum-verified snapshot, labeled with its source, revision, and status when shared. OpenWrite remains the record manager. Archived/invalid records can be requested explicitly; current record questions check OpenWrite again. Set `LITEHARNESS_OPENWRITE_ORIGIN` for a nondefault loopback origin (default `http://127.0.0.1:8787`). See [ADR 0022](docs/adr/0022-openwrite-record-previews.md).

## Contributing and license

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow and [SECURITY.md](SECURITY.md) for the trust boundary and vulnerability reporting. Opencozy is licensed under the [MIT License](LICENSE). It is an independent project and is not affiliated with OpenAI. Third-party software retains its own licenses.
