# smart-sync-state.ps1
# studio-data.json / studio-state.json은 JSON 내부 savedAt 필드 기준으로, studio-secrets.json(API 키)은
# 파일 수정시각 기준으로 더 최신인 쪽을 양방향 복사
# (studio-state.json은 git push/pull 대신 OneDrive 동기화로 전환 — PC간 실시간 반영을 위해 git 동기화 대체)

param(
    [string]$LocalData    = "C:\yeori-studio\app\data",
    [string]$CloudData    = "$env:USERPROFILE\OneDrive\yeori-studio-sync\_app-data",
    [string]$LocalSecrets = "C:\yeori-studio\app\studio-secrets.json",
    [string]$CloudSecrets = "$env:USERPROFILE\OneDrive\yeori-studio-sync\_app-data\studio-secrets.json",
    [string]$LocalState   = "C:\yeori-studio\app\studio-state.json",
    [string]$CloudState   = "$env:USERPROFILE\OneDrive\yeori-studio-sync\_app-data\studio-state.json"
)

function Sync-JsonBySavedAt {
    param([string]$LocalPath, [string]$CloudPath, [string]$Label)

    $ld = $null; $cd = $null

    if (Test-Path $LocalPath) {
        try {
            $raw = [System.IO.File]::ReadAllText($LocalPath, [System.Text.Encoding]::UTF8)
            $ld  = [datetime]($raw | ConvertFrom-Json).savedAt
        } catch {}
    }
    if (Test-Path $CloudPath) {
        try {
            $raw = [System.IO.File]::ReadAllText($CloudPath, [System.Text.Encoding]::UTF8)
            $cd  = [datetime]($raw | ConvertFrom-Json).savedAt
        } catch {}
    }

    $cloudDir = Split-Path $CloudPath
    $localDir = Split-Path $LocalPath
    if (-not (Test-Path $cloudDir)) { New-Item -ItemType Directory -Force -Path $cloudDir | Out-Null }
    if (-not (Test-Path $localDir))  { New-Item -ItemType Directory -Force -Path $localDir  | Out-Null }

    if ($ld -and $cd) {
        if ($ld -ge $cd) {
            Write-Host "  [$Label] Local 최신 ($ld) -> Cloud 복사"
            Copy-Item $LocalPath $CloudPath -Force
        } else {
            Write-Host "  [$Label] Cloud 최신 ($cd) -> Local 복사"
            Copy-Item $CloudPath $LocalPath -Force
        }
    } elseif ($ld) {
        Write-Host "  [$Label] Local만 있음 -> Cloud 복사"
        Copy-Item $LocalPath $CloudPath -Force
    } elseif ($cd) {
        Write-Host "  [$Label] Cloud만 있음 -> Local 복사"
        Copy-Item $CloudPath $LocalPath -Force
    } else {
        Write-Host "  [$Label] 양쪽 없음 - 건너뜀"
    }
}

function Sync-JsonByMTime {
    param([string]$LocalPath, [string]$CloudPath, [string]$Label)

    $cloudDir = Split-Path $CloudPath
    $localDir = Split-Path $LocalPath
    if (-not (Test-Path $cloudDir)) { New-Item -ItemType Directory -Force -Path $cloudDir | Out-Null }
    if (-not (Test-Path $localDir))  { New-Item -ItemType Directory -Force -Path $localDir  | Out-Null }

    $lt = if (Test-Path $LocalPath) { (Get-Item $LocalPath).LastWriteTimeUtc } else { $null }
    $ct = if (Test-Path $CloudPath) { (Get-Item $CloudPath).LastWriteTimeUtc } else { $null }

    if ($lt -and $ct) {
        if ($lt -ge $ct) {
            Write-Host "  [$Label] Local 최신 ($lt) -> Cloud 복사"
            Copy-Item $LocalPath $CloudPath -Force
        } else {
            Write-Host "  [$Label] Cloud 최신 ($ct) -> Local 복사"
            Copy-Item $CloudPath $LocalPath -Force
        }
    } elseif ($lt) {
        Write-Host "  [$Label] Local만 있음 -> Cloud 복사"
        Copy-Item $LocalPath $CloudPath -Force
    } elseif ($ct) {
        Write-Host "  [$Label] Cloud만 있음 -> Local 복사"
        Copy-Item $CloudPath $LocalPath -Force
    } else {
        Write-Host "  [$Label] 양쪽 없음 - 건너뜀"
    }
}

Write-Host ""
Sync-JsonBySavedAt `
    -LocalPath "$LocalData\studio-data.json" `
    -CloudPath  "$CloudData\studio-data.json" `
    -Label      "studio-data.json"

Sync-JsonBySavedAt `
    -LocalPath $LocalState `
    -CloudPath $CloudState `
    -Label     "studio-state.json"

Sync-JsonByMTime `
    -LocalPath $LocalSecrets `
    -CloudPath $CloudSecrets `
    -Label     "studio-secrets.json"
Write-Host ""
