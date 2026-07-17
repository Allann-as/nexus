<#
    check.ps1 - the quality gate.

    Every milestone must pass this before it is considered done. Runs the same
    checks a CI server would, locally and offline.

    Usage:  .\check.ps1          full gate
            .\check.ps1 -Quick   skip the release build (fast inner loop)

    Note: native stderr is deliberately NOT redirected. Windows PowerShell 5.1
    wraps redirected native stderr in ErrorRecords and flips $? even on a clean
    exit 0, which would make every step here look like a failure.
#>
[CmdletBinding()]
param([switch]$Quick)

Set-Location $PSScriptRoot

# rustup installs here, but a shell opened before install has a stale PATH.
$cargoBin = Join-Path $env:USERPROFILE '.cargo\bin'
if (Test-Path $cargoBin) { $env:Path = "$cargoBin;$env:Path" }

$script:failed = @()

function Invoke-Step {
    param([string]$Name, [scriptblock]$Body)

    Write-Host ''
    Write-Host "  -> $Name" -ForegroundColor Cyan
    $sw = [Diagnostics.Stopwatch]::StartNew()

    & $Body
    $ok = $LASTEXITCODE -eq 0
    $sw.Stop()
    $secs = [math]::Round($sw.Elapsed.TotalSeconds, 1)

    if ($ok) {
        Write-Host "     ok  ($secs s)" -ForegroundColor Green
    } else {
        Write-Host "     FAILED (exit $LASTEXITCODE, $secs s)" -ForegroundColor Red
        $script:failed += $Name
    }
}

Write-Host 'NEXUS - quality gate' -ForegroundColor White

Invoke-Step 'cargo fmt --check' { cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check }
Invoke-Step 'cargo clippy -D warnings' { cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings }
Invoke-Step 'cargo test' { cargo test --manifest-path src-tauri/Cargo.toml }
Invoke-Step 'tsc --noEmit' { npx tsc --noEmit }
Invoke-Step 'vite build' { npx vite build }

if (-not $Quick) {
    Invoke-Step 'cargo build --release' { cargo build --manifest-path src-tauri/Cargo.toml --release }
}

Write-Host ''
if ($script:failed.Count -gt 0) {
    Write-Host "FAILED: $($script:failed -join ', ')" -ForegroundColor Red
    exit 1
}
Write-Host 'All checks passed.' -ForegroundColor Green
exit 0
