# TikZ Studio - stop the API and the web UI started by the desktop app.
$ErrorActionPreference = 'SilentlyContinue'
foreach ($port in 8788, 5188) {
  $conns = Get-NetTCPConnection -LocalPort $port -State Listen
  if (-not $conns) { Write-Host ("  {0} already free" -f $port); continue }
  $conns.OwningProcess | Sort-Object -Unique | ForEach-Object {
    Write-Host ("  stop {0} (pid {1})" -f $port, $_)
    Stop-Process -Id $_ -Force
  }
}
Write-Host 'stopped.'
Start-Sleep -Seconds 1
