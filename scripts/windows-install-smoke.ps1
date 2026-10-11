param(
  [Parameter(Mandatory = $true)]
  [string]$InstallerPath,
  [int]$StartupSeconds = 5
)

$ErrorActionPreference = 'Stop'

$resolvedInstaller = (Resolve-Path -LiteralPath $InstallerPath).Path
Write-Host "Installing Resonance silently from: $resolvedInstaller"

$installProcess = Start-Process -FilePath $resolvedInstaller -ArgumentList '/S' -Wait -PassThru
if ($installProcess.ExitCode -ne 0) {
  throw "Resonance installer exited with code $($installProcess.ExitCode)."
}

# Tauri's per-user NSIS installer normally targets one of these locations. Search
# these roots rather than hard-coding a single install path across installer versions.
$searchRoots = @(
  (Join-Path $env:LOCALAPPDATA 'Programs\Resonance'),
  (Join-Path $env:LOCALAPPDATA 'Resonance'),
  (Join-Path $env:LOCALAPPDATA 'Programs')
) | Select-Object -Unique

$installedExe = $null
foreach ($root in $searchRoots) {
  if (-not (Test-Path -LiteralPath $root)) {
    continue
  }

  $match = Get-ChildItem -LiteralPath $root -Filter 'resonance.exe' -File -Recurse -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($match) {
    $installedExe = $match.FullName
    break
  }
}

if (-not $installedExe) {
  throw "Installer completed, but Resonance.exe was not found under the expected per-user install locations."
}

Write-Host "Installed executable: $installedExe"
$appProcess = $null
try {
  $appProcess = Start-Process -FilePath $installedExe -WorkingDirectory (Split-Path -Parent $installedExe) -PassThru
  Start-Sleep -Seconds $StartupSeconds
  $appProcess.Refresh()

  if ($appProcess.HasExited) {
    throw "Resonance exited during the $StartupSeconds-second startup smoke test (exit code $($appProcess.ExitCode))."
  }

  Write-Host "PASS: Installed Resonance launched and remained running for $StartupSeconds seconds."
}
finally {
  if ($appProcess -and -not $appProcess.HasExited) {
    Stop-Process -Id $appProcess.Id -Force -ErrorAction SilentlyContinue
  }
}
