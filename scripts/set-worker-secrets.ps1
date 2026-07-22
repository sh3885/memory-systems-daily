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

function Invoke-WranglerSecretPut {
    param([string]$Name, [string]$Value, [string]$Config)

    $wrangler = Get-Command wrangler -ErrorAction SilentlyContinue
    if ($wrangler) {
        $Value | & wrangler secret put $Name --config $Config
    } else {
        $Value | & npx.cmd wrangler secret put $Name --config $Config
    }

    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
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
    "GITHUB_CONTENT_DIRECTORY",
    "APPROVAL_SIGNING_SECRET",
    "PUBLIC_SITE_URL"
)

$values = Read-DotEnvWithPem $EnvPath
if (-not $DryRun -and -not (Test-Path -LiteralPath $ConfigPath)) {
    throw "Wrangler config not found: $ConfigPath. Create it from wrangler.toml.example and fill the D1 database_id first."
}

foreach ($name in $secretNames) {
    if (-not $values.ContainsKey($name) -or [string]::IsNullOrWhiteSpace([string]$values[$name])) {
        Write-Host ("SKIP    {0} is missing" -f $name)
        continue
    }

    if ($DryRun) {
        Write-Host ("WOULD   {0}" -f $name)
    } else {
        Write-Host ("SETTING {0}" -f $name)
        Invoke-WranglerSecretPut $name ([string]$values[$name]) $ConfigPath
    }
}

if ($DryRun) {
    Write-Host "Dry run complete. No secrets were uploaded."
} else {
    Write-Host "Worker secrets uploaded."
}
