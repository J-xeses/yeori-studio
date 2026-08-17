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
}
"@

$rect = New-Object CapCutWin+RECT
[CapCutWin]::GetWindowRect($proc.MainWindowHandle, [ref]$rect) | Out-Null

$titleB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$proc.MainWindowTitle))

$result = @{
  running = $true
  pid = $proc.Id
  windowTitleB64 = $titleB64
  x = $rect.Left
  y = $rect.Top
  width = ($rect.Right - $rect.Left)
  height = ($rect.Bottom - $rect.Top)
}
$result | ConvertTo-Json -Compress
