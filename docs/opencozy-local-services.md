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

Start or restart the services:

```sh
./scripts/opencozy-services.sh start
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
