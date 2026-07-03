# bootstrap-repo.ps1 - Thin shim delegating to Node.js cross-platform script
# Deprecated: use `node tools/bootstrap-repo.js` directly instead.
# This shim remains for backwards compatibility on Windows.

param(
    [string]$RepoPath = (Get-Location).Path,
    [string]$Slug = "",
    [switch]$SkipGraphInit,
    [switch]$InstallDeps,
    [switch]$All,
    [int]$Depth = 3
)

$args = @()
if ($RepoPath -and $RepoPath -ne (Get-Location).Path) { $args += $RepoPath }
if ($Slug) { $args += "--slug=$Slug" }
if ($SkipGraphInit) { $args += "--skip-graph" }
if ($InstallDeps) { $args += "--install-deps" }
if ($All) { $args += "--all" }
if ($Depth -ne 3) { $args += "--depth=$Depth" }

node tools/bootstrap-repo.js @args
