# shot.ps1 — captura a janela do NEXUS para um PNG.
#
# Acha a janela pelo título, traz para a frente, e fotografa os pixels dela.
# Uso: .\shot.ps1 -Out caminho.png [-Title NEXUS]
param([string]$Out, [string]$ProcName = "nexus")

Add-Type -AssemblyName System.Drawing, System.Windows.Forms

# DPI AWARENESS — sem isto o processo le coordenadas VIRTUALIZADAS (logicas) e
# captura so a fatia superior-esquerda de uma janela fisica maior. Foi
# exatamente esse artefato que fez a dirigida parecer mostrar telas cortadas.
Add-Type @"
using System; using System.Runtime.InteropServices;
public class Dpi {
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v);
}
"@
# DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = -4
[Dpi]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
}
"@

# Pelo PROCESSO, nao pelo titulo: a janela do VS Code se chama
# "Nexus v1.3 Cockpit ... - Visual Studio Code" e casaria com qualquer
# filtro de titulo por "nexus".
$proc = Get-Process -Name $ProcName -ErrorAction SilentlyContinue |
  Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1

if (-not $proc) {
  Write-Error "processo '$ProcName' sem janela. Rodando: $((Get-Process | Where-Object MainWindowHandle -ne 0 | ForEach-Object { $_.ProcessName }) -join ', ')"
  exit 1
}

$h = $proc.MainWindowHandle
[Win]::ShowWindow($h, 9) | Out-Null   # SW_RESTORE
[Win]::SetForegroundWindow($h) | Out-Null
Start-Sleep -Milliseconds 700

$r = New-Object Win+RECT
[Win]::GetWindowRect($h, [ref]$r) | Out-Null
$w = $r.R - $r.L
$hh = $r.B - $r.T
if ($w -le 0 -or $hh -le 0) { Write-Error "janela sem area ($w x $hh)"; exit 1 }

$bmp = New-Object System.Drawing.Bitmap $w, $hh
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.L, $r.T, 0, 0, $bmp.Size)
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()

Write-Host "ok: $Out ($w x $hh) de '$($proc.MainWindowTitle)'"
