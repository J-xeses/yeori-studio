<#
foreground-window.ps1 -- Returns the currently-focused (foreground) window's
title, process name, and on-screen rectangle, for automated screen-region
recording. Unlike capcut-window.ps1 (which matches a specific process name),
this follows whatever window the user last switched to -- used right after
the "switch to the target screen" countdown so BROLL/general recordings
crop to that window instead of capturing the whole (possibly multi-monitor)
desktop. Outputs a single-line JSON object to stdout.

NOTE: keep this file ASCII-only (see capcut-window.ps1 for why). Title and
process name may contain non-ASCII text -- returned as Base64.

Usage:
  powershell -NoProfile -ExecutionPolicy Bypass -File foreground-window.ps1
#>

Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class FgWin {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")]
  public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")]
  public static extern int GetSystemMetrics(int nIndex);
}
"@

$hwnd = [FgWin]::GetForegroundWindow()
if ($hwnd -eq [IntPtr]::Zero) {
  @{ found = $false } | ConvertTo-Json -Compress
  exit 0
}

$len = [FgWin]::GetWindowTextLength($hwnd)
$sb = New-Object System.Text.StringBuilder ($len + 1)
[FgWin]::GetWindowText($hwnd, $sb, $sb.Capacity) | Out-Null
$title = $sb.ToString()

$procId = 0
[FgWin]::GetWindowThreadProcessId($hwnd, [ref]$procId) | Out-Null
$procName = ""
try { $procName = (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch { }

$rect = New-Object FgWin+RECT
[FgWin]::GetWindowRect($hwnd, [ref]$rect) | Out-Null

# capcut-window.ps1과 동일한 이유 -- 가상 데스크톱 원점(멀티모니터 시 음수일 수 있음) 보정.
$vsX = [FgWin]::GetSystemMetrics(76)
$vsY = [FgWin]::GetSystemMetrics(77)

$result = @{
  found = $true
  processName = $procName
  titleB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$title))
  x = ($rect.Left - $vsX)
  y = ($rect.Top - $vsY)
  width = ($rect.Right - $rect.Left)
  height = ($rect.Bottom - $rect.Top)
}
$result | ConvertTo-Json -Compress
