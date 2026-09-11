#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

echo "scripts/tailscale-serve.sh is kept for compatibility."
echo "Using the private-WAN publisher instead."
exec node "${ROOT}/scripts/private-wan.mjs" serve
