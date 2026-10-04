# Read installation metadata only. Never execute registry commands or shortcut arguments.
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$targets = New-Object 'System.Collections.Generic.List[object]'
$apps = @(
  @{ provider = 'codex'; label = '^Codex(?:\s+\d.*)?$'; exe = 'Codex.exe' },
  @{ provider = 'workbuddy'; label = '^WorkBuddy(?:\s+\d.*)?$'; exe = 'WorkBuddy.exe' },
  @{ provider = 'zcode'; label = '^ZCode(?:\s+\d.*)?$'; exe = 'ZCode.exe' },
  @{ provider = 'deepseek'; label = '^DeepSeek Harness(?:\s+\d.*)?$'; exe = 'DeepSeek Harness.exe' }
)
function Add-Executable($app, $path) {
  if ($path -and [IO.Path]::GetFileName($path) -ieq $app.exe -and (Test-Path -LiteralPath $path -PathType Leaf)) {
    $targets.Add(@{ provider = $app.provider; path = $path })
  }
}
$entries = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
foreach ($app in $apps) {
  foreach ($entry in $entries) {
    if ($entry.DisplayName -notmatch $app.label) { continue }
    if ($entry.InstallLocation) { Add-Executable $app (Join-Path $entry.InstallLocation $app.exe) }
    if ($entry.DisplayIcon) {
      $icon = ([regex]::Replace($entry.DisplayIcon, ',\s*-?\d+\s*$', '')).Trim('"')
      Add-Executable $app $icon
      Add-Executable $app (Join-Path ([IO.Path]::GetDirectoryName($icon)) $app.exe)
    }
  }
}
$shortcutShell = New-Object -ComObject WScript.Shell
$menus = @((Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'), (Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs'))
foreach ($menu in $menus) {
  foreach ($link in (Get-ChildItem -LiteralPath $menu -Filter '*.lnk' -Recurse)) {
    foreach ($app in $apps) {
      if ($link.BaseName -match $app.label) { Add-Executable $app ($shortcutShell.CreateShortcut($link.FullName).TargetPath) }
    }
  }
}
# Store installations may expose only an application ID, rather than a readable executable.
Get-StartApps | Where-Object { $_.Name -eq 'Codex' -and $_.AppID -match '^OpenAI\.Codex_[A-Za-z0-9]+![A-Za-z0-9.]+$' } | ForEach-Object {
  $targets.Add(@{ provider = 'codex'; app_id = $_.AppID })
}
Get-AppxPackage -Name OpenAI.Codex | ForEach-Object {
  $package = $_
  $manifest = Get-AppxPackageManifest -Package $package.PackageFullName
  foreach ($application in ($manifest.Package.Applications.Application | Where-Object { $_.Id -eq 'App' })) {
    $targets.Add(@{ provider = 'codex'; app_id = "$($package.PackageFamilyName)!$($application.Id)" })
  }
}
ConvertTo-Json -InputObject @($targets.ToArray()) -Compress
