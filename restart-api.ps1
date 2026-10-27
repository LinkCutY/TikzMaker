# TikZ Studio - restart the API (and the web UI if it is not running).
# Double-click restart-api.cmd instead of running this file directly.
$ErrorActionPreference = 'SilentlyContinue'
Set-Location -LiteralPath $PSScriptRoot

Write-Host ''
Write-Host '=== TikZ Studio : restart API (8788) ===' -ForegroundColor Cyan

# 1) stop whatever holds 8788
$listeners = Get-NetTCPConnection -LocalPort 8788 -State Listen
if ($listeners) {
  $listeners.OwningProcess | Sort-Object -Unique | ForEach-Object {
    Write-Host ("  stop pid {0}" -f $_)
    Stop-Process -Id $_ -Force
  }
} else {
  Write-Host '  8788 is free'
}
Start-Sleep -Milliseconds 800

# 2) start the API in its own window (close that window to stop it)
Write-Host '  start API -> node server/index.mjs'
Start-Process -FilePath 'node' -ArgumentList 'server/index.mjs' -WorkingDirectory $PSScriptRoot -WindowStyle Normal
Start-Sleep -Milliseconds 1200

# 3) make sure the web UI is up as well
if (-not (Get-NetTCPConnection -LocalPort 5188 -State Listen)) {
  Write-Host '  start web -> npx vite'
  Start-Process -FilePath 'npx.cmd' -ArgumentList 'vite' -WorkingDirectory $PSScriptRoot -WindowStyle Normal
} else {
  Write-Host '  web already on 5188'
}
Start-Sleep -Seconds 5

# 4) verify
try {
  $v = Invoke-WebRequest 'http://127.0.0.1:8788/api/version' -UseBasicParsing -TimeoutSec 8
  Write-Host ('  API OK   ' + $v.Content) -ForegroundColor Green
} catch {
  Write-Host ('  API DOWN ' + $_.Exception.Message) -ForegroundColor Red
}
try {
  $null = Invoke-WebRequest 'http://127.0.0.1:5188/' -UseBasicParsing -TimeoutSec 5
  Write-Host '  WEB OK   http://127.0.0.1:5188' -ForegroundColor Green
} catch {
  Write-Host ('  WEB DOWN ' + $_.Exception.Message) -ForegroundColor Red
}

Write-Host ''
if (-not $env:TIKZ_NO_PAUSE) {
  Write-Host 'Press Enter to close this launcher (the API and Vite keep running in their own windows)'
  Read-Host | Out-Null
}
