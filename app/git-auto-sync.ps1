# Auto commit + pull + push for the yeori-studio repo.
# Called by Task Scheduler (hourly) and by start_yeori.bat on graceful shutdown.
# Safety net so forgetting to manually commit/push only costs at most one cycle.
#
# On conflict (e.g. overlapping work from the other PC), this does NOT try to
# auto-resolve -- it aborts the merge and just logs it, leaving that cycle's
# push for later. A skipped push is much safer than automation mangling code.
# ASCII-only content on purpose: avoids Windows PowerShell 5.1 encoding
# footguns when this runs unattended via Task Scheduler.
#
# $ErrorActionPreference stays at the default 'Continue' -- git writes normal
# progress/status lines to stderr even on success, and 'Stop' would wrap those
# into terminating NativeCommandErrors and abort the script on a false alarm.
# Real failures are instead detected via $LASTEXITCODE after each git call.

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
        Log "Committed local changes"
    } else {
        Log "No local changes"
    }

    git fetch origin | Out-Null
    if ($LASTEXITCODE -ne 0) { Log "ERROR: git fetch failed (exit $LASTEXITCODE)"; exit 1 }

    $counts = (git rev-list --left-right --count origin/master...master) -split '\s+'
    $behind = [int]$counts[0]

    if ($behind -gt 0) {
        git pull origin master --no-edit | Out-Null
        $conflicted = git diff --name-only --diff-filter=U
        if ($conflicted) {
            git merge --abort
            Log "!!! Merge conflict, aborted (needs manual review): $($conflicted -join ', ')"
            exit 1
        }
        if ($LASTEXITCODE -ne 0) { Log "ERROR: git pull failed (exit $LASTEXITCODE)"; exit 1 }
        Log "Pulled $behind commit(s) from origin"
    }

    $counts2 = (git rev-list --left-right --count origin/master...master) -split '\s+'
    $ahead2  = [int]$counts2[1]
    if ($ahead2 -gt 0) {
        git push origin master | Out-Null
        if ($LASTEXITCODE -ne 0) { Log "ERROR: git push failed (exit $LASTEXITCODE)"; exit 1 }
        Log "Pushed $ahead2 commit(s) to origin"
    } else {
        Log "Nothing to push"
    }
} catch {
    Log "ERROR: $($_.Exception.Message)"
    exit 1
}
