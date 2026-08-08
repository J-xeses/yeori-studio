# 여리 스튜디오 저장소 자동 commit + pull + push.
# Task Scheduler(주기 실행)와 start_yeori.bat 종료 시점 둘 다에서 호출된다.
# 사람이 커밋/푸시를 깜빡해도 최대 설정 주기만큼만 작업이 밀리게 하는 안전망.
#
# 충돌이 나면(다른 PC와 겹쳐 작업한 경우 등) 자동으로 병합을 시도하지 않고
# merge를 되돌린 뒤 그대로 멈춘다 -- 자동화가 코드를 망가뜨리는 것보다
# 그 주기의 push가 한 번 밀리는 게 훨씬 안전하다. 직접 확인이 필요하면
# logs\auto-sync.log에 남는다.

$ErrorActionPreference = 'Stop'
$RepoRoot = 'C:\yeori-studio'
$LogFile  = 'C:\yeori-studio\logs\auto-sync.log'

function Log($msg) {
    $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $msg"
    Add-Content -Path $LogFile -Value $line -Encoding utf8
}

New-Item -ItemType Directory -Force -Path (Split-Path $LogFile) | Out-Null
Set-Location $RepoRoot

try {
    $status = git status --porcelain
    if ($status) {
        git add -A
        git commit -m "auto-sync: $(Get-Date -Format 'yyyy-MM-dd HH:mm')" | Out-Null
        Log "로컬 변경사항 커밋함"
    } else {
        Log "로컬 변경사항 없음"
    }

    git fetch origin 2>&1 | Out-Null
    $counts  = (git rev-list --left-right --count origin/master...master) -split '\s+'
    $behind  = [int]$counts[0]
    $ahead   = [int]$counts[1]

    if ($behind -gt 0) {
        git pull origin master --no-edit 2>&1 | Out-Null
        $conflicted = git diff --name-only --diff-filter=U
        if ($conflicted) {
            git merge --abort
            Log "!!! 병합 충돌 발생 -- 자동 처리 중단(직접 확인 필요): $($conflicted -join ', ')"
            exit 1
        }
        Log "origin에서 $behind개 커밋 pull 완료"
    }

    $counts2 = (git rev-list --left-right --count origin/master...master) -split '\s+'
    $ahead2  = [int]$counts2[1]
    if ($ahead2 -gt 0) {
        git push origin master 2>&1 | Out-Null
        Log "origin으로 $ahead2개 커밋 push 완료"
    } else {
        Log "push할 커밋 없음"
    }
} catch {
    Log "오류 발생: $($_.Exception.Message)"
    exit 1
}
