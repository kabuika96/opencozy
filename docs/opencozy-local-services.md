# OpenCozy Local Services

OpenCozy can be supervised locally with two macOS LaunchAgents:

- `com.opencozy.backend.dev` runs `npm run dev --workspace backend` on port `8788`.
- `com.opencozy.frontend.dev` runs `npm run dev --workspace frontend` on port `5175`.

The backend dev command intentionally does not watch source files. Restarting the backend kills active Codex PTYs and makes Codex report an interrupted conversation. Use `npm run dev:backend:watch` only when no live OpenCozy Codex session needs to survive backend file edits.

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
