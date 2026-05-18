# sync_agents.ps1
$claudeRoot = ".claude/agents"
$geminiRoot = ".gemini/agents"
$copilotRoot = ".copilot/agents"

$agents = @(
    @{ name = "jarvis"; category = "executive"; modelGemini = "gemini-3.1-pro-preview"; modelCopilot = "GPT-5.2" },
    @{ name = "nat"; category = "executive"; modelGemini = "gemini-3.1-pro-preview"; modelCopilot = "GPT-5.2" },
    @{ name = "sam"; category = "executive"; modelGemini = "gemini-3.1-pro-preview"; modelCopilot = "GPT-5.2" },
    @{ name = "scrooge"; category = "executive"; modelGemini = "gemini-3-flash-preview"; modelCopilot = "GPT-4o" },
    @{ name = "threepio"; category = "executive"; modelGemini = "gemini-3.1-flash-lite-preview"; modelCopilot = "GPT-5 mini" },
    @{ name = "friday"; category = "engineering"; modelGemini = "gemini-3.1-pro-preview"; modelCopilot = "GPT-5.2" },
    @{ name = "vision"; category = "engineering"; modelGemini = "gemini-3-flash-preview"; modelCopilot = "GPT-4o" },
    @{ name = "wanda"; category = "engineering"; modelGemini = "gemini-3-flash-preview"; modelCopilot = "GPT-4o" },
    @{ name = "ultron"; category = "engineering"; modelGemini = "gemini-3-flash-preview"; modelCopilot = "GPT-4o" },
    @{ name = "astra"; category = "engineering"; modelGemini = "gemini-3-flash-preview"; modelCopilot = "GPT-4o" },
    @{ name = "pym"; category = "engineering"; modelGemini = "gemini-3-flash-preview"; modelCopilot = "GPT-4o" },
    @{ name = "leo"; category = "engineering"; modelGemini = "gemini-3-flash-preview"; modelCopilot = "GPT-4o" },
    @{ name = "beth"; category = "business"; modelGemini = "gemini-3-flash-preview"; modelCopilot = "GPT-4o" },
    @{ name = "scout"; category = "business"; modelGemini = "gemini-3-flash-preview"; modelCopilot = "GPT-4o" }
)

foreach ($agent in $agents) {
    $srcPath = "$claudeRoot/$($agent.category)/$($agent.name).md"
    if (-Not (Test-Path $srcPath)) { continue }
    $content = Get-Content $srcPath -Raw

    $capName = $agent.name.Substring(0,1).ToUpper() + $agent.name.Substring(1)

    # Gemini
    $gemContent = $content -replace '(?m)^model: .*$', "model: $($agent.modelGemini)"
    $gemContent = $gemContent -replace 'CLAUDE.md', 'GEMINI.md'
    $gemContent = $gemContent -replace '\.claude/', '.gemini/'
    if ($gemContent -match '(?s)(---.*?---)') {
        $front = $matches[0]
        $rest = $gemContent.Substring($front.Length)
        $gemContent = $front + "`n`n**Name:** $capName" + $rest
    }
    
    $destGem = "$geminiRoot/$($agent.category)/$($agent.name).md"
    Set-Content -Path $destGem -Value $gemContent

    # Copilot
    $copContent = $content -replace '(?m)^model: .*$', "model: $($agent.modelCopilot)"
    $copContent = $copContent -replace 'CLAUDE.md', 'COPILOT.md'
    $copContent = $copContent -replace '\.claude/', '.copilot/'
    if ($copContent -match '(?s)(---.*?---)') {
        $front = $matches[0]
        $rest = $copContent.Substring($front.Length)
        $copContent = $front + "`n`n**Name:** $capName" + $rest
    }
    
    $destCop = "$copilotRoot/$($agent.category)/$($agent.name).md"
    Set-Content -Path $destCop -Value $copContent
}

# Standards
$stdSrc = "$claudeRoot/shared/ENGINEERING-STANDARDS.md"
if (Test-Path $stdSrc) {
    $stdContent = Get-Content $stdSrc -Raw
    Set-Content -Path "$geminiRoot/shared/ENGINEERING-STANDARDS.md" -Value ($stdContent -replace 'CLAUDE.md', 'GEMINI.md' -replace '\.claude/', '.gemini/' -replace 'Shared Discipline', 'Shared Discipline (Gemini)')
    Set-Content -Path "$copilotRoot/shared/ENGINEERING-STANDARDS.md" -Value ($stdContent -replace 'CLAUDE.md', 'COPILOT.md' -replace '\.claude/', '.copilot/' -replace 'Shared Discipline', 'Shared Discipline (Copilot)')
}
