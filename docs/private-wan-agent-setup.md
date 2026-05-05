# Private WAN Agent Setup

Use this when setting up OpenCozy for access from enrolled devices away from the same local network. Private WAN should use Tailscale Serve, not Funnel.

During a fresh OpenCozy install, first get the local app working. Then ask the user whether they want private WAN access through Tailscale Serve. If they agree, proceed through this guide end to end. If they decline, leave WAN disabled and report the local/LAN URLs only.

## Requirements

- Tailscale installed on the Codex Host.
- The Codex Host enrolled in the user's tailnet.
- Tailscale Serve enabled for the tailnet.
- HTTPS available through Tailscale Serve.
- `OPENCOZY_HOST=127.0.0.1` so the backend is not directly exposed.
- `OPENCOZY_ALLOWED_HOSTS` includes every browser-facing hostname or IP the user will open.
- `OPENCOZY_TAILSCALE_SOCKET` is set when using a non-default Tailscale daemon socket.

Do not use Tailscale Funnel. Do not expose the backend port directly.

## macOS Setup

Prefer the official Tailscale macOS app when the user can install it from the desktop. If a non-interactive agent cannot install the app because the installer needs sudo, the Homebrew CLI plus OpenCozy's userspace helper is acceptable for developer-mode OpenCozy:

```sh
brew install tailscale
npm run tailscale-userspace:start
tailscale --socket=$HOME/.local/share/opencozy-tailscale/tailscaled.sock up --hostname=jarvis-opencozy
```

After the user approves the Tailscale login URL, read the node DNS name:

```sh
tailscale --socket=$HOME/.local/share/opencozy-tailscale/tailscaled.sock status --json
```

Then update `.env`:

```sh
OPENCOZY_HOST=127.0.0.1
OPENCOZY_ALLOWED_HOSTS=jarvis.local,10.0.0.158,jarvis-opencozy.example-tailnet.ts.net
OPENCOZY_TAILSCALE_SOCKET=/Users/you/.local/share/opencozy-tailscale/tailscaled.sock
```

Backend `.env` changes require a backend restart. Agents must ask for explicit user permission before restarting because restart kills active OpenCozy/Codex sessions.

## Start Serve

Check state:

```sh
npm run private-wan:doctor
```

For WAN access, start the local OpenCozy services and Tailscale Serve together:

```sh
npm run wan:start
```

That is equivalent to starting the local OpenCozy services, then publishing the frontend through the tailnet-private HTTPS origin:

```sh
npm run services:start
npm run private-wan:serve
```

If Tailscale says Serve is not enabled, open the URL it prints and ask the user to enable Serve in the Tailscale admin page. Then rerun `npm run private-wan:serve`.

Verify:

```sh
npm run private-wan:status
```

The expected URL is `https://<tailscale-dns-name>`. OpenCozy Settings should show the same WAN Tunnel config and state.

To disable only the HTTPS tailnet origin while leaving local OpenCozy running:

```sh
npm run private-wan:stop
```

When the user asks to stop WAN OpenCozy entirely, stop Serve and the local OpenCozy services together:

```sh
npm run wan:stop
```

Agents must ask for explicit permission before running `npm run wan:stop`, `npm run services:stop`, `npm run services:restart`, or any equivalent backend stop/restart command because those commands kill active OpenCozy/Codex sessions.

## iPhone Connection

On the iPhone:

1. Install Tailscale from the App Store.
2. Log in to the same tailnet used by the Codex Host.
3. Allow the VPN configuration and make sure Tailscale is connected.
4. If device approval is enabled for the tailnet, approve the iPhone in Tailscale admin.
5. Open the HTTPS Serve URL in Safari, for example `https://jarvis-opencozy.tail4aadb4.ts.net/`.
6. Once it loads, use Safari's Share menu to add OpenCozy to the Home Screen.

When OpenCozy uses the Homebrew userspace Tailscale daemon on macOS, the Mac itself may not resolve the MagicDNS hostname through normal `curl` or Safari because that daemon does not install system DNS. Other enrolled devices running the regular Tailscale client should still resolve the HTTPS Serve URL.

## Validation

From an enrolled iPhone:

- Open the HTTPS Tailscale Serve URL.
- Confirm the PWA loads without mixed-content errors.
- Start a new session.
- Resume an existing session.
- Confirm terminal output streams.
- Confirm terminal input, arrows, Enter, and keyboard editing work.
- Confirm Preview still works for URLs reachable from that device.

Record any failures in the relevant issue before changing the network model.
