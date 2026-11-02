#!/usr/bin/env bash
# macOS/Linux counterpart of check.ps1.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
command -v node >/dev/null || { echo "Node.js was not found. Install Node.js 24." >&2; exit 1; }
[ -f "$root/node_modules/astro/bin/astro.mjs" ] || { echo "Dependencies are missing. Run npm ci before checking the site." >&2; exit 1; }

export ASTRO_TELEMETRY_DISABLED=1
cd "$root"
node node_modules/astro/bin/astro.mjs check
node node_modules/astro/bin/astro.mjs build
node --test automation/tests/*.test.mjs

if [ "${SKIP_VISUAL_CHECK:-}" = "1" ]; then
  echo "Skipping the page check because SKIP_VISUAL_CHECK=1."
  exit 0
fi

# Every built page must load: status, console errors, layout, links, images.
node scripts/visual-check.mjs
