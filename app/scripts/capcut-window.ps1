<#
capcut-window.ps1 -- Detects the running CapCut desktop app and its on-screen
window rectangle, for automated screen-region recording (MakingTab CAPCUT
section). Outputs a single-line JSON object to stdout.

NOTE: keep this file ASCII-only. Windows PowerShell 5.1 reads a BOM-less
.ps1 file using the system ANSI codepage, and on a Korean system a stray
multi-byte comment can corrupt nearby bytes badly enough to break the C#
source passed to Add-Type (same issue documented in
win-file-dialog-helper.ps1). The window title (which may contain non-ASCII
text) is returned as Base64 for the same reason -- decode it on the Node
side.

Usage:
  powershell -NoProfile -ExecutionPolicy Bypass -File capcut-window.ps1
#>

$proc = Get-Process -Name "CapCut" -ErrorAction SilentlyContinue |
  Where-Object { $_.MainWindowHandle -ne 0 } |
  Select-Object -First 1

if (-not $proc) {
  @{ running = $false } | ConvertTo-Json -Compress
  exit 0
}

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class CapCutWin {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")]
  public static extern int GetSystemMetrics(int nIndex);
}
"@

$rect = New-Object CapCutWin+RECT
[CapCutWin]::GetWindowRect($proc.MainWindowHandle, [ref]$rect) | Out-Null

# SM_XVIRTUALSCREEN=76, SM_YVIRTUALSCREEN=77 -- top-left of the full virtual
# desktop across all monitors. On a multi-monitor setup where a monitor sits
# left of or above the primary, this is negative (e.g. -1920). ffmpeg's
# gdigrab -i desktop captures the whole virtual desktop starting at THIS
# origin as pixel (0,0), not at the primary monitor's (0,0) -- so a crop
# filter needs window coordinates translated into that space, or a window on
# a non-primary monitor gets cropped from the wrong place entirely (verified
# by direct testing: raw GetWindowRect coords produced a black/empty crop,
# origin-adjusted coords produced the correct CapCut window content).
$vsX = [CapCutWin]::GetSystemMetrics(76)
$vsY = [CapCutWin]::GetSystemMetrics(77)

$titleB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$proc.MainWindowTitle))

$result = @{
  running = $true
  pid = $proc.Id
  windowTitleB64 = $titleB64
  x = ($rect.Left - $vsX)
  y = ($rect.Top - $vsY)
  width = ($rect.Right - $rect.Left)
  height = ($rect.Bottom - $rect.Top)
}
$result | ConvertTo-Json -Compress
