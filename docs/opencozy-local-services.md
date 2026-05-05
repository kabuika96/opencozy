# OpenCozy Local Services

OpenCozy can be supervised locally with two macOS LaunchAgents:

- `com.opencozy.backend.dev` runs `npm run dev --workspace backend` on port `8788`.
- `com.opencozy.frontend.dev` runs `npm run dev --workspace frontend` on port `5175`.

## Backend Restart Policy

The backend dev command intentionally does not watch source files. The backend owns the live Codex PTY processes, so restarting it kills active Codex sessions. The frontend silently reconnects after transient PWA background WebSocket drops, but a backend restart removes the session itself; when the session is resumed Codex may report `Conversation interrupted`.

For normal development, frontend changes update through Vite/HMR, but backend changes require a manual restart:

```sh
npm run services:restart
```

Agents must ask the user for explicit permission before running that restart or any equivalent backend stop, kill, unload, or replacement command. A backend restart kills active OpenCozy/Codex sessions even when the restart is intentional.

If the permission request comes from an OpenCozy Codex session, run the restart from a detached process so killing the backend does not cancel its own restart command. Prefer this pattern:

```sh
tmux new-session -d -s opencozy-backend-restart 'cd /Users/openclaw/Documents/projects/opencozy && sleep 2 && npm run services:restart > /tmp/opencozy-backend-restart.log 2>&1'
```

Then verify the detached restart instead of issuing a second restart:

```sh
tail -n 200 /tmp/opencozy-backend-restart.log
curl -fsS http://127.0.0.1:8788/api/health
curl -fsS http://127.0.0.1:5175/
./scripts/opencozy-services.sh status
```

Expected healthy state: the backend health endpoint returns `{"ok":true,"name":"opencozy",...}`, the frontend returns HTML, and `status` shows both LaunchAgents running with listeners on `8788` and `5175`.

Do not change the durable backend service back to `tsx watch` or another auto-restarting watcher. Use `npm run dev:backend:watch` only for backend-only work when no live OpenCozy Codex session needs to survive file edits.

The agents use `KeepAlive`, so launchd restarts them after crashes, process kills, or login. The foreground `npm run dev` command is still useful while actively developing, but do not run it at the same time as these services because both paths use the same default ports.

Install the LaunchAgent plists:

```sh
./scripts/opencozy-services.sh install
```

Start the services:

```sh
./scripts/opencozy-services.sh start
```

`start` is idempotent: if a LaunchAgent is already loaded, it leaves that service running. Use `restart` only when the backend must reload code or `.env` changes and the user has explicitly approved killing active sessions.

Restart the services:

```sh
./scripts/opencozy-services.sh restart
```

To intentionally turn OpenCozy down, unload the agents instead of killing their node processes:

```sh
./scripts/opencozy-services.sh stop
```

Inspect state:

```sh
./scripts/opencozy-services.sh status
curl -fsS http://127.0.0.1:8788/api/health
curl -fsS http://127.0.0.1:5175/
```

Logs are written to:

- `~/Library/Logs/OpenCozy/backend.out.log`
- `~/Library/Logs/OpenCozy/backend.err.log`
- `~/Library/Logs/OpenCozy/frontend.out.log`
- `~/Library/Logs/OpenCozy/frontend.err.log`

Follow logs:

```sh
./scripts/opencozy-services.sh logs
```

## Private WAN With Tailscale Serve

For phone access away from the same local network, use Tailscale Serve to publish the frontend dev server as one tailnet-private HTTPS OpenCozy origin. Tailscale Serve is private to your tailnet; Tailscale Funnel is public and is not supported for OpenCozy.

On macOS, the preferred path is the official Tailscale app. For developer machines where only the Homebrew CLI is installed, OpenCozy also includes an optional user-mode Tailscale daemon helper:

```sh
brew install tailscale
npm run tailscale-userspace:start
tailscale --socket=$HOME/.local/share/opencozy-tailscale/tailscaled.sock up --hostname=jarvis-opencozy
```

That userspace daemon does not install a system TUN device; it exists to give OpenCozy a private Tailscale Serve origin. Set `OPENCOZY_TAILSCALE_SOCKET=$HOME/.local/share/opencozy-tailscale/tailscaled.sock` when using this helper.

Use a root `.env` like this:

```sh
OPENCOZY_HOST=127.0.0.1
OPENCOZY_PORT=8788
OPENCOZY_FRONTEND_PORT=5175
OPENCOZY_ALLOWED_HOSTS=jarvis.local,10.0.0.158,jarvis.your-tailnet.ts.net
OPENCOZY_TAILSCALE_SOCKET=/Users/you/.local/share/opencozy-tailscale/tailscaled.sock
```

`OPENCOZY_ALLOWED_HOSTS` should contain the browser-facing names you actually open, without `https://` and without paths. Include direct LAN hostnames or IPs if you want the same service to work from LAN and Tailscale.

## Access Lifecycle

Direct local/LAN access starts only the local OpenCozy backend and frontend:

```sh
npm run lan:start
```

Open the LAN URL printed by Vite or shown in the service logs, such as `http://<lan-host>:5175/`.

Private WAN access starts the same local OpenCozy services and then enables the Tailscale Serve HTTPS origin:

```sh
npm run wan:start
```

Use `wan:start` when the user asks for OpenCozy to be available through local services and enrolled Tailscale devices. It runs the same local service startup as `lan:start`, then runs `npm run private-wan:serve`. If the services are already loaded, startup leaves them running instead of replacing the backend process.

Check that the local WAN configuration is ready:

```sh
npm run private-wan:doctor
```

Serve the frontend through HTTPS inside your tailnet without changing local service state:

```sh
npm run private-wan:serve
```

Check the Serve URL:

```sh
npm run private-wan:status
```

Open the reported `https://...ts.net` URL from an enrolled device. The frontend proxies API and WebSocket traffic to the localhost backend, so the backend port should not be reachable as a second WAN endpoint.

To disable only the Tailscale HTTPS origin and leave local OpenCozy running:

```sh
npm run private-wan:stop
```

To take down WAN OpenCozy as a whole, stop Serve and the local OpenCozy services together:

```sh
npm run wan:stop
```

To take down direct local/LAN OpenCozy:

```sh
npm run lan:stop
```

`lan:stop`, `wan:stop`, `services:stop`, and `services:restart` stop or replace the backend. Agents must ask for explicit user permission before running them because active OpenCozy/Codex sessions will be killed.

If OpenCozy started the optional Homebrew userspace Tailscale daemon only for this project, the user may also ask to stop it:

```sh
npm run tailscale-userspace:stop
```

Do not stop the official Tailscale app or a shared Tailscale daemon unless the user explicitly asks; it may be used by other tools.

Tailscale Serve requires HTTPS certificates to be enabled for the tailnet. If that is not already enabled, the Tailscale CLI may prompt you to enable it. See the Tailscale docs for [Serve](https://tailscale.com/docs/features/tailscale-serve), the [`tailscale serve` CLI](https://tailscale.com/docs/reference/tailscale-cli/serve), and [HTTPS certificates](https://tailscale.com/docs/how-to/set-up-https-certificates).

Project Preview can also use Tailscale Serve for port-based private HTTPS Preview Published Origins. Those published origins point at localhost-only OpenCozy Local Preview Proxies so the previewed app remains root-mounted without requiring framework-specific host allowlist changes. See [project-preview.md](project-preview.md) for the target/dependency publisher flow, direct LAN target behavior, proxy port configuration, and iPhone validation checklist.
