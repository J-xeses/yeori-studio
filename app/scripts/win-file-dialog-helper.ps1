<#
win-file-dialog-helper.ps1 -- Automates the native Windows "Open File" dialog.

CapCut's "Upload from device" opens a real Windows common file-open dialog,
not a browser <input type=file> -- Puppeteer's filechooser event never fires
for it (confirmed by direct testing). This script waits for that dialog,
writes the file path(s) straight into the filename edit control via
WM_SETTEXT (no SendKeys escaping issues with spaces/parentheses/non-ASCII
paths), then presses Enter.

NOTE: keep this file ASCII-only. Windows PowerShell 5.1 reads a BOM-less
.ps1 file using the system ANSI codepage, and on a Korean system a stray
multi-byte comment can corrupt nearby bytes badly enough to break the C#
source passed to Add-Type (confirmed by direct testing -- a lambda a few
lines after a Korean comment failed to parse). Pass any non-ASCII data
(file paths, window titles) as Base64 from the caller instead of embedding
it as a literal here.

Usage:
  $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('["C:\\a.jpg","C:\\b.jpg"]'))
  powershell -NoProfile -ExecutionPolicy Bypass -File win-file-dialog-helper.ps1 -PathsJsonB64 $b64
#>
param(
  [Parameter(Mandatory=$true)][string]$PathsJsonB64,
  [int]$TimeoutMs = 15000
)
$PathsJson = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($PathsJsonB64))

Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class DlgHelper {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr hWndParent, EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode, EntryPoint="SendMessageW")]
  public static extern IntPtr SendMessageText(IntPtr hWnd, int Msg, IntPtr wParam, string lParam);
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  public static IntPtr FindFirstEditDescendant(IntPtr hParent) {
    IntPtr found = IntPtr.Zero;
    EnumChildWindows(hParent, (hWnd, lParam) => {
      var cls = new StringBuilder(256);
      GetClassNameW(hWnd, cls, cls.Capacity);
      if (cls.ToString() == "Edit") { found = hWnd; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }

  // Match by the standard common-dialog window class (#32770) plus the
  // presence of a filename Edit control, instead of matching window title
  // text -- title-based matching needs a "Open"/localized-title literal in
  // this file, which is exactly the multi-byte content that broke Add-Type.
  public static IntPtr FindOpenDialogWindow() {
    IntPtr found = IntPtr.Zero;
    EnumWindows((hWnd, lParam) => {
      if (!IsWindowVisible(hWnd)) return true;
      var cls = new StringBuilder(256);
      GetClassNameW(hWnd, cls, cls.Capacity);
      if (cls.ToString() != "#32770") return true;
      if (FindFirstEditDescendant(hWnd) == IntPtr.Zero) return true;
      found = hWnd;
      return false;
    }, IntPtr.Zero);
    return found;
  }

  const int WM_SETTEXT = 0x000C;
  public static void SetText(IntPtr hWnd, string text) {
    SendMessageText(hWnd, WM_SETTEXT, IntPtr.Zero, text);
  }
}
"@

$paths = $PathsJson | ConvertFrom-Json -ErrorAction Stop
$quoted = ($paths | ForEach-Object { '"' + $_ + '"' }) -join ' '

$deadline = (Get-Date).AddMilliseconds($TimeoutMs)
$hDlg = [IntPtr]::Zero
while ((Get-Date) -lt $deadline) {
  $hDlg = [DlgHelper]::FindOpenDialogWindow()
  if ($hDlg -ne [IntPtr]::Zero) { break }
  Start-Sleep -Milliseconds 300
}
if ($hDlg -eq [IntPtr]::Zero) {
  Write-Output "TIMEOUT: dialog not found"
  exit 1
}

$hEdit = [DlgHelper]::FindFirstEditDescendant($hDlg)
if ($hEdit -eq [IntPtr]::Zero) {
  Write-Output "ERROR: edit control not found"
  exit 1
}

[DlgHelper]::SetText($hEdit, $quoted)
Start-Sleep -Milliseconds 150
[DlgHelper]::SetForegroundWindow($hDlg) | Out-Null
Start-Sleep -Milliseconds 200
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
Write-Output "OK"
