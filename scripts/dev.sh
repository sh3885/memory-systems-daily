#!/usr/bin/env bash
# macOS/Linux counterpart of dev.ps1.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
command -v node >/dev/null || { echo "Node.js was not found. Install Node.js 24." >&2; exit 1; }
[ -f "$root/node_modules/astro/bin/astro.mjs" ] || { echo "Dependencies are missing. Run npm ci before starting the site." >&2; exit 1; }

export ASTRO_TELEMETRY_DISABLED=1
cd "$root"
exec node node_modules/astro/bin/astro.mjs dev --host 127.0.0.1
