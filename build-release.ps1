[CmdletBinding()]
param(
    [string]$OutputDirectory = 'release',
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Invoke-BuildCommand {
    param([string]$Command, [string[]]$Arguments)
    Write-Host ("> {0} {1}" -f $Command, ($Arguments -join ' ')) -ForegroundColor Cyan
    if ($DryRun) { return }
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Command failed with exit code $LASTEXITCODE."
    }
}

Push-Location -LiteralPath $PSScriptRoot
try {
    $package = Get-Content -LiteralPath 'package.json' -Raw | ConvertFrom-Json
    $config = Get-Content -LiteralPath 'src-tauri/tauri.conf.json' -Raw | ConvertFrom-Json
    $cargoManifest = Get-Content -LiteralPath 'src-tauri/Cargo.toml' -Raw
    $cargoVersion = [regex]::Match($cargoManifest, '(?m)^version\s*=\s*"([^"]+)"').Groups[1].Value
    $version = $package.version
    if ($version -notmatch '^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$') {
        throw "Invalid release version: $version"
    }
    if ($config.version -ne $version -or $cargoVersion -ne $version) {
        throw 'package.json, Cargo.toml and tauri.conf.json must have the same version.'
    }

    foreach ($command in @('node', 'npm.cmd', 'cargo')) {
        if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
            throw "Required command not found: $command. See the Windows prerequisites in README.md."
        }
    }
    $target = 'x86_64-pc-windows-msvc'
    $product = $config.productName
    $outputRoot = if ([IO.Path]::IsPathRooted($OutputDirectory)) {
        [IO.Path]::GetFullPath($OutputDirectory)
    } else {
        [IO.Path]::GetFullPath((Join-Path $PSScriptRoot $OutputDirectory))
    }
    $destination = Join-Path $outputRoot $version
    $portable = Join-Path $destination "$product-$version-windows-x64-portable.zip"
    $nsisName = "${product}_${version}_x64-setup.exe"
    $msiName = "${product}_${version}_x64_en-US.msi"

    Write-Host "Building $product $version for Windows x64" -ForegroundColor Green
    Write-Host "Output: $destination"
    if (-not (Test-Path -LiteralPath 'node_modules/.bin/tauri.cmd')) {
        Invoke-BuildCommand -Command 'npm.cmd' -Arguments @('ci')
    }

    # Cargo metadata respects custom CARGO_TARGET_DIR and Cargo configuration.
    # An explicit target keeps the file paths and release architecture predictable.
    if (-not $DryRun) {
        $metadataJson = & cargo metadata --manifest-path src-tauri/Cargo.toml --no-deps --format-version 1
        if ($LASTEXITCODE -ne 0) { throw 'Could not resolve the Cargo output directory.' }
        $metadata = $metadataJson | ConvertFrom-Json
        $releaseDir = Join-Path $metadata.target_directory "$target/release"
        New-Item -ItemType Directory -Path $destination -Force | Out-Null
    }

    Invoke-BuildCommand -Command 'npm.cmd' -Arguments @('run', 'tauri:build:portable', '--', '--target', $target)
    if (-not $DryRun) {
        $exe = Join-Path $releaseDir "$($package.name).exe"
        if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw "Portable executable not found: $exe" }
        # Archive just the freshly built portable exe before the installed build
        # overwrites it. Never collect an adjacent data/ folder or credentials.
        $temporaryZip = Join-Path $destination ("portable-{0}.zip" -f [guid]::NewGuid())
        try {
            Compress-Archive -LiteralPath $exe -DestinationPath $temporaryZip -CompressionLevel Optimal
            Move-Item -LiteralPath $temporaryZip -Destination $portable -Force
        } finally {
            if (Test-Path -LiteralPath $temporaryZip) { Remove-Item -LiteralPath $temporaryZip }
        }
    }
    Write-Host "Portable ZIP: $portable"

    Invoke-BuildCommand -Command 'npm.cmd' -Arguments @('run', 'tauri:build:installed', '--', '--target', $target, '--bundles', 'nsis,msi')
    if (-not $DryRun) {
        foreach ($asset in @(
            @{ Source = Join-Path $releaseDir "bundle/nsis/$nsisName"; Name = $nsisName },
            @{ Source = Join-Path $releaseDir "bundle/msi/$msiName"; Name = $msiName }
        )) {
            if (-not (Test-Path -LiteralPath $asset.Source -PathType Leaf)) { throw "Installer not found: $($asset.Source)" }
            Copy-Item -LiteralPath $asset.Source -Destination (Join-Path $destination $asset.Name) -Force
        }
        Get-ChildItem -LiteralPath $destination -File |
            Where-Object { $_.Name -in @([IO.Path]::GetFileName($portable), $nsisName, $msiName) } |
            Select-Object Name, Length
        Write-Host "Release assets are ready in $destination" -ForegroundColor Green
    } else {
        Write-Host "NSIS installer: $(Join-Path $destination $nsisName)"
        Write-Host "MSI installer: $(Join-Path $destination $msiName)"
        Write-Host 'Dry run only: no builds or files created.'
    }
} finally {
    Pop-Location
}
