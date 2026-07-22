param(
    [Parameter(Mandatory = $true)]
    [string]$WorkerUrl,

    [string]$EnvPath = ".env"
)

$ErrorActionPreference = "Stop"

function Read-DotEnv {
    param([string]$Path)

    $values = @{}
    if (-not (Test-Path -LiteralPath $Path)) {
        throw "Environment file not found: $Path"
    }

    foreach ($line in Get-Content -LiteralPath $Path) {
        if ($line -match '^\s*$' -or $line -match '^\s*#') {
            continue
        }

        if ($line -match '^\s*([^=\s]+)\s*=\s*(.*)$') {
            $values[$matches[1]] = $matches[2].Trim()
        }
    }

    return $values
}

function Require-EnvValue {
    param($Values, [string]$Name)
    if (-not $Values.ContainsKey($Name) -or [string]::IsNullOrWhiteSpace([string]$Values[$Name])) {
        throw "$Name is missing in .env"
    }
    return [string]$Values[$Name]
}

$values = Read-DotEnv $EnvPath
$botToken = Require-EnvValue $values "TELEGRAM_BOT_TOKEN"
$secret = Require-EnvValue $values "TELEGRAM_WEBHOOK_SECRET"

$baseUrl = $WorkerUrl.Trim().TrimEnd("/")
$webhookUrl = "$baseUrl/telegram/webhook"
$telegramApiUrl = "https://api.telegram.org/bot$botToken/setWebhook"
$body = @{
    url = $webhookUrl
    secret_token = $secret
    allowed_updates = @("message", "callback_query")
} | ConvertTo-Json

$result = Invoke-RestMethod -Method Post -Uri $telegramApiUrl -ContentType "application/json" -Body $body

if (-not $result.ok) {
    throw ("Telegram setWebhook failed: {0}" -f ($result | ConvertTo-Json -Depth 8))
}

Write-Host ("Telegram webhook registered: {0}" -f $webhookUrl)
