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

$tests = Get-ChildItem -LiteralPath (Join-Path $root "automation\tests") -Filter "*.test.mjs" | Select-Object -ExpandProperty FullName
if (-not $tests) {
    throw "No automation tests were found."
}

& $node --test $tests
exit $LASTEXITCODE

