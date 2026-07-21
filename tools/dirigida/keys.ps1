# keys.ps1 — manda teclas para a janela do NEXUS.
# Uso: .\keys.ps1 -Keys "242807"   |   .\keys.ps1 -Keys "^k" -Raw
param([string]$Keys, [switch]$Raw, [string]$ProcName = "nexus")

Add-Type -AssemblyName System.Windows.Forms

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Fg {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
}
"@

$proc = Get-Process -Name $ProcName -ErrorAction SilentlyContinue |
  Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $proc) { Write-Error "processo '$ProcName' sem janela"; exit 1 }

[Fg]::ShowWindow($proc.MainWindowHandle, 9) | Out-Null
[Fg]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 500

if ($Raw) {
  [System.Windows.Forms.SendKeys]::SendWait($Keys)
} else {
  # Uma tecla por vez, com folga: o PIN tem animacao por digito e um burst
  # inteiro chega antes de o React montar o proximo estado.
  foreach ($ch in $Keys.ToCharArray()) {
    [System.Windows.Forms.SendKeys]::SendWait($ch)
    Start-Sleep -Milliseconds 160
  }
}
Start-Sleep -Milliseconds 900
Write-Host "enviado: $Keys"
