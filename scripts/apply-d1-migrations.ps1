param(
    [string]$DatabaseName = "memory-systems-daily-db",
    [string]$MigrationsPath = "automation/storage/migrations",
    [switch]$Local
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
        if ($Local) {
            & npx.cmd wrangler d1 execute $DatabaseName --file $file.FullName
        } else {
            & npx.cmd wrangler d1 execute $DatabaseName --remote --file $file.FullName
        }
    } else {
        if ($Local) {
            & wrangler d1 execute $DatabaseName --file $file.FullName
        } else {
            & wrangler d1 execute $DatabaseName --remote --file $file.FullName
        }
    }
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
}

$location = if ($Local) { "local" } else { "remote" }
Write-Host ("Applied {0} D1 migrations to {1} ({2})." -f $migrationFiles.Count, $DatabaseName, $location)
