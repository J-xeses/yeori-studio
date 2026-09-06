# Idempotent Cloudflare tunnel health-check + self-heal for yeori-studio MCP.
# Called by start_yeori.bat step [2] on every run (cold start AND re-run).
#
# Behavior:
#   - tunnel process alive AND current URL answers /api/health 200  -> do nothing
#   - otherwise: kill any stale cloudflared + sync-tunnel.js, wait for the
#     local proxy (:3001) to be up, then (re)launch sync-tunnel.js in its own
#     "Yeori Cloudflare Tunnel" window. sync-tunnel.js itself then grabs a fresh
#     quick-tunnel URL and syncs it to Vercel (MCP_BRIDGE_URL) + redeploys.
#
# This is what makes re-running start_yeori.bat safe: an existing studio core
# stays untouched and only the dead tunnel is revived (see start_yeori.bat
# [pre-0] repair mode).
#
# ASCII-only content on purpose -- same Windows PowerShell 5.1 encoding reason
# as git-auto-sync.ps1 / ensure-auto-sync-task.ps1.

$ErrorActionPreference = 'Continue'

$AppRoot   = 'C:\yeori-studio\app'
$StatePath = Join-Path $AppRoot '.tunnel-state.json'
$ProxyHealth = 'http://localhost:3001/api/health'
$VercelScope = 'won566800-7736s-projects'

function Get-TunnelProc {
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and $_.CommandLine -like '*sync-tunnel.js*' }
}

function Test-Url([string]$url, [int]$timeoutSec = 8) {
    if (-not $url) { return $false }
    try {
        $r = Invoke-WebRequest -Uri $url -TimeoutSec $timeoutSec -UseBasicParsing -ErrorAction Stop
        return ($r.StatusCode -eq 200)
    } catch {
        return $false
    }
}

# --- 1. current state -------------------------------------------------------
$proc = Get-TunnelProc

$tunnelUrl = $null
if (Test-Path $StatePath) {
    try { $tunnelUrl = (Get-Content $StatePath -Raw | ConvertFrom-Json).url } catch { }
}

$healthy = $false
if ($proc -and $tunnelUrl) {
    $healthy = Test-Url "$tunnelUrl/api/health"
}

if ($proc -and $healthy) {
    Write-Output "        [ensure-tunnel] Tunnel healthy ($tunnelUrl) -- skip."
    return
}

# --- 2. repair -------------------------------------------------------------
if ($proc) {
    Write-Output "        [ensure-tunnel] Tunnel process alive but URL dead/stale -- restarting."
    foreach ($p in $proc) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
} else {
    Write-Output "        [ensure-tunnel] No tunnel process -- starting."
}
Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

# NOTE: no need to wait for the proxy. Cloudflare assigns the quick-tunnel URL
# at the edge immediately (independent of origin health), so sync-tunnel.js can
# parse it and push to Vercel right away; cloudflared just 502s until the proxy
# (:3001, started later in start_yeori.bat step [5]) comes up and then serves.
if (-not (Test-Url $ProxyHealth 3)) {
    Write-Output "        [ensure-tunnel] (proxy :3001 not up yet -- fine, tunnel connects once it is)"
}

# vercel login check -- the tunnel works without it, but the URL will NOT reach
# the claude.ai remote connector until MCP_BRIDGE_URL is updated + redeployed.
try {
    $null = cmd /c "vercel whoami --scope $VercelScope 2>nul"
    if ($LASTEXITCODE -ne 0) {
        Write-Output "        [ensure-tunnel] WARN: 'vercel' not logged in -- tunnel will start but Vercel sync fails."
        Write-Output "        [ensure-tunnel]       Fix: cd $AppRoot ; vercel login  (then Ctrl+C the tunnel window and: node scripts\sync-tunnel.js)"
    }
} catch {
    Write-Output "        [ensure-tunnel] WARN: could not run 'vercel' to check login state."
}

Start-Process -FilePath 'cmd.exe' `
    -ArgumentList '/k', 'title Yeori Cloudflare Tunnel && node scripts\sync-tunnel.js' `
    -WorkingDirectory $AppRoot | Out-Null

Write-Output "        [ensure-tunnel] 'Yeori Cloudflare Tunnel' window (re)launched -- watch it for the new URL + Vercel redeploy."
