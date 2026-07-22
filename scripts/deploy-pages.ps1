param(
    [string]$ProjectName = "memory-systems-daily",
    [string]$Branch = "main",
    [string]$Directory = "dist",
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

if (-not $SkipBuild) {
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\check.ps1
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
}

$commitHash = (& git rev-parse HEAD).Trim()
$commitMessage = (& git log -1 --pretty=%s).Trim()
$absoluteDirectory = (Resolve-Path -LiteralPath $Directory).Path

Push-Location ([System.IO.Path]::GetTempPath())
try {
    & npx.cmd wrangler pages deploy $absoluteDirectory `
        --project-name $ProjectName `
        --branch $Branch `
        --commit-hash $commitHash `
        --commit-message $commitMessage `
        --commit-dirty=true
} finally {
    Pop-Location
}

exit $LASTEXITCODE
