# dev.ps1 — sobe o app dev num diretório de dados ISOLADO (ADR-0048).
#
# Dirigidas de UI NUNCA tocam o %APPDATA%/Nexus real. Este script aponta o app
# para .\.devdata (gitignorado), semeia dados sintéticos na primeira vez, e então
# lança o `tauri dev`. O banco real do usuário só é aberto quando ELE usa o app.
#
#   .\dev.ps1            # semeia se vazio, depois roda
#   .\dev.ps1 -Reseed    # apaga o .devdata e semeia do zero
#   .\dev.ps1 -NoSeed    # roda sem semear (banco vazio ou o que já existe)

param([switch]$Reseed, [switch]$NoSeed)

# NÃO usar $ErrorActionPreference = "Stop": no PowerShell 5.1 ele trata o stderr
# NORMAL de um comando nativo (o "Compiling ..." do cargo) como erro fatal e
# aborta um build que está indo bem. Os passos que importam checam $LASTEXITCODE.
$root = Join-Path $PSScriptRoot ".devdata"
$env:NEXUS_DATA_DIR = $root

if ($Reseed -and (Test-Path $root)) {
  Write-Host "removendo $root ..." -ForegroundColor Yellow
  Remove-Item -Recurse -Force $root
}

$dbExists = Test-Path (Join-Path $root "nexus.db")
if (-not $NoSeed -and (-not $dbExists -or $Reseed)) {
  Write-Host "semeando dados sinteticos em $root ..." -ForegroundColor Cyan
  cargo run --manifest-path src-tauri/Cargo.toml --example seed_demo
  if ($LASTEXITCODE -ne 0) { throw "seed_demo falhou" }
}

Write-Host "NEXUS_DATA_DIR = $root" -ForegroundColor Green
Write-Host "abrindo o app dev (dados de teste, nao o %APPDATA% real)..." -ForegroundColor Green
npm run tauri dev
