# click.ps1 — clica numa coordenada RELATIVA A JANELA, em pixels fisicos.
# Uso: .\click.ps1 -X 1387 -Y 333
param([int]$X, [int]$Y, [string]$ProcName = "nexus")

Add-Type @"
using System; using System.Runtime.InteropServices;
public class Clk {
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RC r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, int e);
  [StructLayout(LayoutKind.Sequential)] public struct RC { public int L,T,R,B; }
}
"@
[Clk]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null

$p = Get-Process -Name $ProcName -ErrorAction SilentlyContinue |
  Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $p) { Write-Error "sem janela"; exit 1 }

[Clk]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 400

$r = New-Object Clk+RC
[Clk]::GetWindowRect($p.MainWindowHandle, [ref]$r) | Out-Null
$sx = $r.L + $X
$sy = $r.T + $Y

[Clk]::SetCursorPos($sx, $sy)
Start-Sleep -Milliseconds 250
[Clk]::mouse_event(0x0002, 0, 0, 0, 0)
[Clk]::mouse_event(0x0004, 0, 0, 0, 0)
Start-Sleep -Milliseconds 900
Write-Host "clique em $sx,$sy (janela em $($r.L),$($r.T))"
