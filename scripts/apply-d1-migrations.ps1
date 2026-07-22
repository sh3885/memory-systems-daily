param(
    [string]$DatabaseName = "memory-systems-daily-db",
    [string]$MigrationsPath = "automation/storage/migrations"
)

$ErrorActionPreference = "Stop"

$wrangler = Get-Command wrangler -ErrorAction SilentlyContinue
$useNpx = $null -eq $wrangler

$migrationFiles = Get-ChildItem -LiteralPath $MigrationsPath -Filter "*.sql" | Sort-Object Name
if ($migrationFiles.Count -eq 0) {
    throw "No D1 migration files found under $MigrationsPath"
}

foreach ($file in $migrationFiles) {
    Write-Host ("Applying D1 migration: {0}" -f $file.Name)
    if ($useNpx) {
        & npx.cmd wrangler d1 execute $DatabaseName --file $file.FullName
    } else {
        & wrangler d1 execute $DatabaseName --file $file.FullName
    }
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
}

Write-Host ("Applied {0} D1 migrations to {1}." -f $migrationFiles.Count, $DatabaseName)
