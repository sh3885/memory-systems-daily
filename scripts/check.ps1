$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$portableNode = Join-Path $root ".tools\node-v24.18.0-win-x64\node.exe"
$systemNode = Get-Command node -ErrorAction SilentlyContinue

if ($systemNode) {
    $node = $systemNode.Source
} elseif (Test-Path -LiteralPath $portableNode) {
    $node = $portableNode
} else {
    throw "Node.js was not found. Install Node.js or restore .tools/node-v24.18.0-win-x64."
}

$astro = Join-Path $root "node_modules\astro\bin\astro.mjs"
if (-not (Test-Path -LiteralPath $astro)) {
    throw "Dependencies are missing. Run npm install before checking the site."
}

$env:ASTRO_TELEMETRY_DISABLED = "1"
& $node $astro check
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& $node $astro build
exit $LASTEXITCODE
