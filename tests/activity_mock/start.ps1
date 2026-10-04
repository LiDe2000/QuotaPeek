param([int]$Port = 1432)
$ErrorActionPreference = 'Stop'
python -m uvicorn app:app --app-dir $PSScriptRoot --host 127.0.0.1 --port $Port
