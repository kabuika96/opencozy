# Contributing

Thanks for helping improve OpenCozy. This project is still early, so small pull requests with clear behavior are easiest to review.

## Local Setup

```sh
npm install
npm run dev
```

The app runs at `http://127.0.0.1:5175`. Backend health is available at `http://127.0.0.1:8788/api/health`.

## Before Opening a Pull Request

Run the full check:

```sh
npm run check
```

For focused work, these are also useful:

```sh
npm run typecheck
npm run test
npm run build
npm run lint
```

## Development Notes

- Keep local app state and Codex output out of commits. `data/`, `.env`, and `.scratch/` are ignored for this reason.
- Preserve the Codex-only PTY boundary. OpenCozy should not become a general-purpose remote shell.
- Add tests when changing session creation, WebSocket behavior, terminal input, local app shortcuts, or mobile interaction behavior.
- Keep public docs free of personal paths, LAN hostnames, tokens, and machine-specific assumptions.

## Pull Request Shape

Include:

- What changed.
- How you verified it.
- Any migration or local-data implications.
