param(
    [string]$EnvPath = ".env"
)

$ErrorActionPreference = "Stop"

function Read-DotEnv {
    param([string]$Path)

    $values = @{}
    if (-not (Test-Path -LiteralPath $Path)) {
        return $values
    }

    foreach ($line in Get-Content -LiteralPath $Path) {
        if ($line -match '^\s*$' -or $line -match '^\s*#') {
            continue
        }

        if ($line -match '^\s*([^=\s]+)\s*=\s*(.*)$') {
            $key = $matches[1]
            $value = $matches[2].Trim()
            if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
                $value = $value.Substring(1, $value.Length - 2)
            }
            $values[$key] = $value
        }
    }

    return $values
}

function Test-HasValue {
    param($Values, [string]$Name)
    return $Values.ContainsKey($Name) -and -not [string]::IsNullOrWhiteSpace([string]$Values[$Name])
}

function Write-GroupStatus {
    param($Values, [string]$Title, [string[]]$Names, [string[]]$ShowValues = @())

    Write-Host ""
    Write-Host $Title
    foreach ($name in $Names) {
        $hasValue = Test-HasValue $Values $name
        if ($hasValue -and $ShowValues -contains $name) {
            Write-Host ("  OK      {0}={1}" -f $name, $Values[$name])
        } elseif ($hasValue) {
            Write-Host ("  OK      {0}=<set>" -f $name)
        } else {
            Write-Host ("  MISSING {0}" -f $name)
        }
    }
}

$envValues = Read-DotEnv $EnvPath
$currentRequired = @(
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_BOT_ID",
    "TELEGRAM_WEBHOOK_SECRET",
    "TELEGRAM_ALLOWED_USER_ID",
    "TELEGRAM_ALLOWED_CHAT_ID",
    "AI_MODE",
    "DAILY_CURRICULUM_REF",
    "DAILY_SCHEDULE_CRON",
    "CONTENT_TIMEZONE"
)
$claudeApi = @(
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_MODEL"
)
$githubPublishing = @(
    "GITHUB_APP_ID",
    "GITHUB_APP_PRIVATE_KEY",
    "GITHUB_INSTALLATION_ID",
    "GITHUB_OWNER",
    "GITHUB_REPOSITORY",
    "GITHUB_CONTENT_BRANCH",
    "GITHUB_CONTENT_DIRECTORY",
    "APPROVAL_SIGNING_SECRET"
)
$afterDeploy = @(
    "PUBLIC_SITE_URL",
    "DEPLOYMENT_PROVIDER",
    "DEPLOYMENT_TOKEN"
)
$showValues = @(
    "AI_MODE",
    "ANTHROPIC_MODEL",
    "DAILY_CURRICULUM_REF",
    "DAILY_SCHEDULE_CRON",
    "CONTENT_TIMEZONE",
    "GITHUB_OWNER",
    "GITHUB_REPOSITORY",
    "GITHUB_CONTENT_BRANCH",
    "GITHUB_CONTENT_DIRECTORY"
)

Write-Host ("Checking {0}" -f (Resolve-Path -LiteralPath $EnvPath -ErrorAction SilentlyContinue))
Write-GroupStatus $envValues "Required for Telegram manual mode" $currentRequired $showValues
Write-GroupStatus $envValues "Claude API opt-in commands" $claudeApi $showValues
Write-GroupStatus $envValues "GitHub approval publishing" $githubPublishing $showValues
Write-GroupStatus $envValues "Known only after deployment" $afterDeploy $showValues

$missingRequired = @($currentRequired | Where-Object { -not (Test-HasValue $envValues $_) })
if ($missingRequired.Count -gt 0) {
    Write-Host ""
    Write-Host "Missing required values:"
    $missingRequired | ForEach-Object { Write-Host ("  - {0}" -f $_) }
    exit 1
}

Write-Host ""
Write-Host "Current manual Telegram mode has the required local values."
