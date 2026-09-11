# Contributing to Opencozy

Use Node.js 24 and npm. Install with `npm ci`, copy `.env.example` to `.env`, and run `npm run dev`. See [README.md](README.md) for authentication and optional integrations.

Read [CONTEXT.md](CONTEXT.md) and the relevant [architecture decisions](docs/adr/) before changing behavior or integration boundaries. Keep Codex protocol handling in the backend adapters and keep default services on localhost.

Before submitting a pull request:

```bash
npm run check
npm run test:prompt-cache
```

The first command runs workspace type checks, tests, and builds. The second uses the pinned Codex binary with a local model stub; no model account or live model call is needed. For frontend interaction changes, also install Chromium with `npm exec --workspace frontend -- playwright install chromium` and run `npm run test:browser --workspace frontend`.

Describe the problem, resulting behavior, and checks actually run. Add focused regression coverage for behavior changes. Never commit `.env`, credentials, databases, messages, uploaded files, personal machine configuration, or generated artifacts. Backend restarts interrupt active Runs; obtain approval before restarting a shared running instance.

Use GitHub issues for public bug reports and feature proposals. Include reproduction steps and sanitized diagnostics. Local agent task notes may remain under ignored `.scratch/issues/`; they are not the public tracker. Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

Contributions are provided under the repository's MIT License.
