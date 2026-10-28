$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$logDir = Join-Path $root 'logs'
New-Item -ItemType Directory -Force $logDir | Out-Null

function PortUp($p) {
  # A real connect is faster and more reliable than enumerating listeners, which
  # can transiently report nothing while a process is starting up.
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $iar = $client.BeginConnect('127.0.0.1', $p, $null, $null)
    if (-not $iar.AsyncWaitHandle.WaitOne(400)) { return $false }
    $client.EndConnect($iar)
    return $true
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

function ListenerPids($p) {
  return @(Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique)
}

function IsProjectApiProcess($processId, $allowLegacyRelative) {
  if (-not $processId) { return $false }
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
  if (-not $proc -or $proc.Name -notmatch '^node(\.exe)?$') { return $false }
  $entry = Join-Path $root 'server\index.mjs'
  $quoted = [regex]::Escape($entry)
  if ($proc.CommandLine -match $quoted) { return $true }
  # One-time migration for launchers created before the absolute entry path and
  # PID file were introduced. It is accepted only for the dedicated API port.
  return $allowLegacyRelative -and $proc.CommandLine -match 'server[\\/]index\.mjs'
}

function IsProjectWebProcess($processId, $allowLegacyRelative) {
  if (-not $processId) { return $false }
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
  if (-not $proc -or $proc.Name -notmatch '^node(\.exe)?$') { return $false }
  $entry = Join-Path $root 'node_modules\vite\bin\vite.js'
  $quoted = [regex]::Escape($entry)
  if ($proc.CommandLine -match $quoted) { return $true }
  return $allowLegacyRelative -and $proc.CommandLine -match 'node_modules[\\/]vite[\\/]bin[\\/]vite\.js'
}

function RestartProjectApi {
  $pidFile = Join-Path $logDir 'api.pid'
  $listenerIds = @(ListenerPids 8788)
  $owned = @()
  foreach ($ownerId in $listenerIds) {
    if (IsProjectApiProcess $ownerId $true) { $owned += $ownerId }
  }
  if ($listenerIds.Count -gt $owned.Count) {
    throw 'Port 8788 is owned by another program. TikZ Studio did not terminate it.'
  }
  if (Test-Path $pidFile) {
    $savedId = [int](Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
    if ((IsProjectApiProcess $savedId $false) -and $owned -notcontains $savedId) { $owned += $savedId }
  }
  foreach ($ownerId in ($owned | Select-Object -Unique)) {
    Stop-Process -Id $ownerId -Force -ErrorAction Stop
  }
  $stopDeadline = (Get-Date).AddSeconds(8)
  while ((Get-Date) -lt $stopDeadline -and (PortUp 8788)) { Start-Sleep -Milliseconds 150 }
  if (PortUp 8788) { throw 'The previous TikZ Studio API did not stop within 8 seconds.' }

  $nodePath = (Get-Command node -ErrorAction Stop).Source
  $apiEntry = Join-Path $root 'server\index.mjs'
  $apiProcess = Start-Process -FilePath $nodePath -ArgumentList $apiEntry -WorkingDirectory $root -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $logDir 'api.out.log') -RedirectStandardError (Join-Path $logDir 'api.err.log')
  $startDeadline = (Get-Date).AddSeconds(20)
  while ((Get-Date) -lt $startDeadline -and -not (PortUp 8788)) { Start-Sleep -Milliseconds 150 }
  $active = @(ListenerPids 8788)
  if (-not $active.Count) { throw 'TikZ Studio API did not listen on port 8788 within 20 seconds.' }
  foreach ($activeId in $active) {
    if (-not (IsProjectApiProcess $activeId $true)) { throw 'Port 8788 changed owner while the API was starting.' }
  }
  # Record the real listener rather than a Node version-manager shim process.
  Set-Content -LiteralPath $pidFile -Value $active[0] -Encoding ascii
  return $active[0]
}

function RestartProjectWeb {
  $pidFile = Join-Path $logDir 'web.pid'
  $listenerIds = @(ListenerPids 5188)
  $owned = @()
  foreach ($ownerId in $listenerIds) {
    if (IsProjectWebProcess $ownerId $true) { $owned += $ownerId }
  }
  if ($listenerIds.Count -gt $owned.Count) {
    throw 'Port 5188 is owned by another program. TikZ Studio did not terminate it.'
  }
  if (Test-Path $pidFile) {
    $savedId = [int](Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
    if ((IsProjectWebProcess $savedId $false) -and $owned -notcontains $savedId) { $owned += $savedId }
  }
  foreach ($ownerId in ($owned | Select-Object -Unique)) {
    Stop-Process -Id $ownerId -Force -ErrorAction Stop
  }
  $stopDeadline = (Get-Date).AddSeconds(8)
  while ((Get-Date) -lt $stopDeadline -and (PortUp 5188)) { Start-Sleep -Milliseconds 150 }
  if (PortUp 5188) { throw 'The previous TikZ Studio web server did not stop within 8 seconds.' }

  $nodePath = (Get-Command node -ErrorAction Stop).Source
  $viteEntry = Join-Path $root 'node_modules\vite\bin\vite.js'
  if (-not (Test-Path $viteEntry)) { throw 'Vite is missing. Run npm install in the project first.' }
  $webProcess = Start-Process -FilePath $nodePath -ArgumentList @($viteEntry, '--host', '127.0.0.1', '--port', '5188', '--strictPort') `
    -WorkingDirectory $root -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $logDir 'web.out.log') -RedirectStandardError (Join-Path $logDir 'web.err.log')
  $startDeadline = (Get-Date).AddSeconds(20)
  while ((Get-Date) -lt $startDeadline -and -not (PortUp 5188)) { Start-Sleep -Milliseconds 150 }
  $active = @(ListenerPids 5188)
  if (-not $active.Count) { throw 'TikZ Studio web server did not listen on port 5188 within 20 seconds.' }
  foreach ($activeId in $active) {
    if (-not (IsProjectWebProcess $activeId $true)) { throw 'Port 5188 changed owner while the web server was starting.' }
  }
  Set-Content -LiteralPath $pidFile -Value $active[0] -Encoding ascii
  return $active[0]
}

# Both servers are deliberately restarted on every desktop launch. This makes
# the shortcut an explicit source-sync boundary instead of relying on an old
# API process or a stale Vite/HMR connection to notice file changes.
try {
  $apiPid = RestartProjectApi
  $webPid = RestartProjectWeb
} catch {
  Add-Type -AssemblyName System.Windows.Forms | Out-Null
  [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'TikZ Studio') | Out-Null
  exit 1
}

Add-Type -AssemblyName System.Windows.Forms | Out-Null
$deadline = (Get-Date).AddSeconds(75)
while ((Get-Date) -lt $deadline) {
  if ((PortUp 8788) -and (PortUp 5188)) { break }
  Start-Sleep -Milliseconds 500
}
$okApi = PortUp 8788
$okWeb = PortUp 5188

if (-not ($okApi -and $okWeb)) {
  $tail = @()
  foreach ($f in 'api.err.log', 'web.err.log') {
    if (Test-Path (Join-Path $logDir $f)) { $tail += (Get-Content (Join-Path $logDir $f) -ErrorAction SilentlyContinue | Select-Object -Last 8) }
  }
  $msg = "TikZ Studio could not start.`nAPI=$okApi  Web=$okWeb`n`n" + ($tail -join "`n")
  [System.Windows.Forms.MessageBox]::Show($msg, 'TikZ Studio') | Out-Null
  exit 1
}

# A unique URL forces Edge to fetch the freshly restarted Vite page instead of
# merely focusing an older app window whose JavaScript may predate the sources.
function OpenAppWindow {
  $edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
  if (-not (Test-Path $edge)) { $edge = 'C:\Program Files\Microsoft\Edge\Application\msedge.exe' }
  $stamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $appUrl = "http://127.0.0.1:5188/?source=$stamp"
  if (Test-Path $edge) {
    Start-Process -FilePath $edge -ArgumentList @("--app=$appUrl", '--new-window', '--disable-http-cache', '--window-size=1560,980', '--window-position=80,40')
  } else {
    # No Edge: fall back to the default browser so the user still gets the page.
    Start-Process $appUrl
  }
}
OpenAppWindow
