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

& $node (Join-Path $root "scripts\visual-check.mjs")
exit $LASTEXITCODE

