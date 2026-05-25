#Requires -Version 5.1
<#
.SYNOPSIS
    Create all agent:* labels in the GitHub repo. Idempotent.
    Requires: gh CLI authenticated (gh auth status)
#>

$AGENTS = @("jarvis","friday","sam","ultron","pym","leo","nat","wanda","astra","threepio","r2d2")
$COLOR  = "0075ca"   # blue

foreach ($agent in $AGENTS) {
    $label = "agent:$agent"
    # Check if label exists
    $exists = gh label list --limit 100 2>$null | Select-String $label
    if ($exists) {
        Write-Host "  Exists: $label" -ForegroundColor Gray
    } else {
        gh label create $label --color $COLOR --description "Dispatch to $agent agent" 2>$null
        Write-Host "  Created: $label" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "Labels ready. From phone: create issue -> add label agent:<name> -> agent runs." -ForegroundColor Cyan
