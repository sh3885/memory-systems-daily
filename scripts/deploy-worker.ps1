param(
    [string]$EnvPath = ".env",
    [string]$ConfigPath = "wrangler.toml",
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function Read-DotEnvWithPem {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        throw "Environment file not found: $Path"
    }

    $values = @{}
    $lines = Get-Content -LiteralPath $Path
    for ($index = 0; $index -lt $lines.Count; $index += 1) {
        $line = $lines[$index]
        if ($line -match '^\s*$' -or $line -match '^\s*#') {
            continue
        }

        if ($line -notmatch '^\s*([^=\s]+)\s*=\s*(.*)$') {
            continue
        }

        $key = $matches[1]
        $value = $matches[2].Trim()

        if ($key -eq "GITHUB_APP_PRIVATE_KEY" -and $value -match '^-+BEGIN .*PRIVATE KEY-+') {
            $pemLines = New-Object System.Collections.Generic.List[string]
            $pemLines.Add($value)
            while ($index + 1 -lt $lines.Count) {
                $index += 1
                $pemLines.Add($lines[$index])
                if ($lines[$index] -match '^-+END .*PRIVATE KEY-+') {
                    break
                }
            }
            $value = ($pemLines -join "`n")
        }

        $values[$key] = $value
    }

    return $values
}

if (-not (Test-Path -LiteralPath $ConfigPath)) {
    throw "Wrangler config not found: $ConfigPath"
}

$secretNames = @(
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_BOT_ID",
    "TELEGRAM_WEBHOOK_SECRET",
    "TELEGRAM_ALLOWED_USER_ID",
    "TELEGRAM_ALLOWED_CHAT_ID",
    "AI_MODE",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_MODEL",
    "DAILY_CURRICULUM_REF",
    "CONTENT_TIMEZONE",
    "GITHUB_APP_ID",
    "GITHUB_APP_PRIVATE_KEY",
    "GITHUB_INSTALLATION_ID",
    "GITHUB_OWNER",
    "GITHUB_REPOSITORY",
    "GITHUB_CONTENT_BRANCH",
    "GITHUB_ADMIN_BRANCH",
    "GITHUB_CONTENT_DIRECTORY",
    "APPROVAL_SIGNING_SECRET",
    "PUBLIC_SITE_URL",
    "ADMIN_API_TOKEN"
)

$envValues = Read-DotEnvWithPem $EnvPath
$secrets = [ordered]@{}
foreach ($name in $secretNames) {
    if ($envValues.ContainsKey($name) -and -not [string]::IsNullOrWhiteSpace([string]$envValues[$name])) {
        $secrets[$name] = [string]$envValues[$name]
    }
}

$tempFile = Join-Path ([System.IO.Path]::GetTempPath()) ("memory-systems-daily-secrets-{0}.json" -f ([guid]::NewGuid()))
try {
    $secrets | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $tempFile -Encoding UTF8
    if ($DryRun) {
        Write-Host ("Prepared {0} secrets for dry-run deploy." -f $secrets.Count)
        & npx.cmd wrangler deploy --config $ConfigPath --secrets-file $tempFile --dry-run
    } else {
        Write-Host ("Deploying Worker with {0} secrets." -f $secrets.Count)
        & npx.cmd wrangler deploy --config $ConfigPath --secrets-file $tempFile --message "Deploy Telegram daily learning worker"
    }

    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
} finally {
    if (Test-Path -LiteralPath $tempFile) {
        Remove-Item -LiteralPath $tempFile -Force
    }
}
