param(
  [Parameter(Mandatory = $true)]
  [string]$Url,

  [Parameter(Mandatory = $true)]
  [string[]]$Contains
)

$ErrorActionPreference = "Stop"

$response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 60
if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 300) {
  throw "Unexpected HTTP status $($response.StatusCode) for $Url"
}

$needles = @()
foreach ($entry in $Contains) {
  $needles += $entry -split "," | ForEach-Object { $_.Trim() } | Where-Object { $_ }
}

$missing = @()
foreach ($needle in $needles) {
  if (-not $response.Content.Contains($needle)) {
    $missing += $needle
  }
}

if ($missing.Count -gt 0) {
  throw "Page did not contain expected text: $($missing -join ', ')"
}

$title = [regex]::Match($response.Content, "<title>(.*?)</title>").Groups[1].Value
[pscustomobject]@{
  Url = $Url
  StatusCode = $response.StatusCode
  Title = $title
  Verified = $true
  Checked = $needles
} | ConvertTo-Json -Compress
