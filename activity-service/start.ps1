param(
    [int]$Port = 1431,
    [string]$CatalogFile = (Join-Path $PSScriptRoot 'activities.json')
)
$ErrorActionPreference = 'Stop'
$env:ACTIVITY_CATALOG_FILE = (Resolve-Path -LiteralPath $CatalogFile).Path
python -m uvicorn app:app --app-dir $PSScriptRoot --host 127.0.0.1 --port $Port
