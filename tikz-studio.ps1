# TikZ Studio - open the app from the desktop.
# Starts API + web UI in ONE minimised console window if they are not running,
# waits for the page to answer, then opens a chromeless app window.
# Close that minimised window to stop the servers, or run stop-tikz.cmd.
$ErrorActionPreference = 'SilentlyContinue'
Set-Location -LiteralPath $PSScriptRoot

$apiPort = 8788
$webPort = 5188

function Test-Port([int]$port) {
  return [bool](Get-NetTCPConnection -LocalPort $port -State Listen)
}

# A double click must not start a second stack: a fresh lock means another
# launch is already bringing the servers up.
$lock = Join-Path $env:TEMP 'tikz-studio-launch.lock'
$launching = (Test-Path $lock) -and (((Get-Date) - (Get-Item $lock).LastWriteTime).TotalSeconds -lt 60)

if (-not $launching -and (-not (Test-Port $apiPort) -or -not (Test-Port $webPort))) {
  Set-Content -Path $lock -Value (Get-Date).ToString('o') -Encoding ascii
  # Something is half-dead (a crashed boot, or a leftover from an earlier run).
  # Clear stale project servers first so we never end up with duplicates.
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
    $_.CommandLine -like '*server/index.mjs*' -or $_.CommandLine -like '*vite*bin*'
  } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Milliseconds 500
  Start-Process -FilePath 'cmd.exe' -ArgumentList '/c','npm run dev' -WorkingDirectory $PSScriptRoot -WindowStyle Minimized
}

$url = "http://127.0.0.1:$webPort"
$ready = $false
for ($i = 0; $i -lt 100; $i++) {
  try {
    $null = Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 2
    $ready = $true
    break
  } catch {
    Start-Sleep -Milliseconds 400
  }
}
if (-not $ready) {
  Write-Host 'web UI did not answer; check the minimised "npm run dev" window' -ForegroundColor Yellow
}

$edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
if (-not (Test-Path $edge)) { $edge = 'C:\Program Files\Microsoft\Edge\Application\msedge.exe' }
if (-not (Test-Path $edge)) { $edge = 'C:\Program Files\Google\Chrome\Application\chrome.exe' }

if (Test-Path $edge) {
  Start-Process -FilePath $edge -ArgumentList ("--app={0} --window-size=1560,980 --window-position=80,40" -f $url)
} else {
  Start-Process $url
}
