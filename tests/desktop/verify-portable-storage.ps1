param([string]$Executable)
$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not $Executable) { $Executable = Join-Path $workspace 'src-tauri/target/release/quotapeek.exe' }
$temporaryRoot = [IO.Path]::GetFullPath((Join-Path $workspace '.tmp'))
$smokeRoot = Join-Path $temporaryRoot ('portable-storage-' + [guid]::NewGuid().ToString('N'))
$initial = Join-Path $smokeRoot 'original'
$moved = Join-Path $smokeRoot 'moved'
$workingDirectory = Join-Path $smokeRoot 'shortcut-working-directory'

function Assert-TemporaryPath([string]$Path) {
    $resolved = [IO.Path]::GetFullPath($Path)
    if (-not $resolved.StartsWith($temporaryRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Smoke test path is outside the workspace temporary directory: $resolved"
    }
}

function Run-TestApp([string]$Directory, [string]$Mode) {
    $smokeProcess = Start-Process -FilePath (Join-Path $Directory 'quotapeek.exe') -WorkingDirectory $workingDirectory -WindowStyle Hidden -PassThru
    try {
        $database = Join-Path $Directory 'data/quotapeek.db'
        $ready = $false
        for ($attempt = 0; $attempt -lt 20; $attempt++) {
            Start-Sleep -Milliseconds 500
            $smokeProcess.Refresh()
            if ($smokeProcess.HasExited) { throw "Test application exited with code $($smokeProcess.ExitCode)." }
            if (Test-Path -LiteralPath $database) {
                & node --disable-warning=ExperimentalWarning (Join-Path $PSScriptRoot 'verify-portable-state.cjs') $Mode $database 2>$null
                if ($LASTEXITCODE -eq 0) { $ready = $true; break }
            }
        }
        if (-not $ready) { throw 'Portable state did not become ready within 10 seconds.' }
    } finally {
        if (-not $smokeProcess.HasExited) { $smokeProcess.Kill(); $smokeProcess.WaitForExit() }
    }
}

Assert-TemporaryPath $initial
Assert-TemporaryPath $moved
New-Item -ItemType Directory -Path $initial, $workingDirectory -Force | Out-Null
Copy-Item -LiteralPath $Executable -Destination (Join-Path $initial 'quotapeek.exe')
Run-TestApp $initial 'initial'
& node --disable-warning=ExperimentalWarning (Join-Path $PSScriptRoot 'verify-portable-state.cjs') seed (Join-Path $initial 'data/quotapeek.db')
if ($LASTEXITCODE -ne 0) { throw 'Could not seed synthetic portable state.' }
# Both absolute targets are checked before moving the complete application directory.
Assert-TemporaryPath $initial
Assert-TemporaryPath $moved
Move-Item -LiteralPath $initial -Destination $moved
Run-TestApp $moved 'restored'
if (Test-Path -LiteralPath (Join-Path $workingDirectory 'data')) { throw 'Data was saved relative to the working directory.' }
Write-Output "Portable launch, IPC persistence, folder move and restart passed. Artifacts: $smokeRoot"
