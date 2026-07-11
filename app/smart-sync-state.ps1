# smart-sync-state.ps1
# studio-state.json / studio-data.json을 파일 날짜가 아닌
# JSON 내부 savedAt 필드 기준으로 더 최신인 쪽을 양방향 복사

param(
    [string]$LocalDir  = "C:\yeori-studio\downloads",
    [string]$LocalData = "C:\yeori-studio\app\data",
    [string]$CloudDir  = "$env:USERPROFILE\OneDrive\yeori-studio-sync",
    [string]$CloudData = "$env:USERPROFILE\OneDrive\yeori-studio-sync\_app-data"
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

Write-Host ""
Sync-JsonBySavedAt `
    -LocalPath "$LocalDir\studio-state.json" `
    -CloudPath  "$CloudDir\studio-state.json" `
    -Label      "studio-state.json"

Sync-JsonBySavedAt `
    -LocalPath "$LocalData\studio-data.json" `
    -CloudPath  "$CloudData\studio-data.json" `
    -Label      "studio-data.json"
Write-Host ""
