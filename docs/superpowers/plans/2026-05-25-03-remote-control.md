# Remote Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dispatch agent tasks from a phone via GitHub Issues (fire-and-forget async) or SSH/Termius (interactive), with results posted back as issue comments.

**Architecture:** A self-hosted GitHub Actions runner on the Windows machine listens for issue labels. When `agent:*` label is applied, the workflow runs `claude -p` (print mode) with the issue body as prompt and posts the result as a comment. Issue templates make phone UX smooth.

**Tech Stack:** GitHub Actions (self-hosted runner), PowerShell (runner setup), YAML (workflow), `gh` CLI (label creation), `claude`/`gemini`/`copilot` CLI

**Prerequisite:** Sub-project 2 (Universal Bootstrap) should be complete. `gh` CLI must be authenticated (`gh auth status`).

**Important — CLI invocation in non-interactive mode:**
Claude Code uses `-p "prompt"` for print (non-interactive) mode. The workflow uses:
```
claude -p "$TASK_BODY"
```
Verify this syntax against your installed version: `claude --help | grep -A2 '\-p'`

---

## File Map

| File | Purpose |
|------|---------|
| `.github/workflows/agent-dispatch.yml` | Main dispatch workflow triggered by issue labels |
| `.github/ISSUE_TEMPLATE/agent-task.md` | Phone-friendly issue template |
| `tools/setup-runner.ps1` | One-time self-hosted runner setup on Windows |
| `tools/create-agent-labels.ps1` | Create all `agent:*` labels in the repo |
| `tests/test_remote_control.sh` | Smoke tests for workflow file validity + label existence |

---

## Task 1: Create agent labels in GitHub repo

**Files:**
- Create: `tools/create-agent-labels.ps1`

- [ ] **Step 1: Write failing test**

Create `tests/test_remote_control.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
PASS=0; FAIL=0
ok()   { echo "[PASS] $1"; ((PASS++)); }
fail() { echo "[FAIL] $1"; ((FAIL++)); }

AGENTS=("jarvis" "friday" "sam" "ultron" "pym" "leo" "nat" "wanda" "astra" "threepio")

echo "=== Test: agent labels exist in repo ==="
for agent in "${AGENTS[@]}"; do
  LABEL="agent:$agent"
  gh label list 2>/dev/null | grep -q "$LABEL" \
    && ok "label exists: $LABEL" \
    || fail "label missing: $LABEL"
done

echo "=== Test: workflow file exists and is valid YAML ==="
[ -f ".github/workflows/agent-dispatch.yml" ] \
  && ok "workflow file exists" \
  || fail "workflow file missing"

# Validate YAML structure (check for required keys)
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('.github/workflows/agent-dispatch.yml', 'utf8');
  if (!content.includes('runs-on: self-hosted')) { console.error('missing self-hosted'); process.exit(1); }
  if (!content.includes('agent:')) { console.error('missing agent: trigger'); process.exit(1); }
  console.log('valid');
" 2>/dev/null && ok "workflow has required structure" || fail "workflow missing required structure"

echo "=== Test: issue template exists ==="
[ -f ".github/ISSUE_TEMPLATE/agent-task.md" ] \
  && ok "issue template exists" \
  || fail "issue template missing"

echo ""
echo "========================================"
printf "  PASSED: %d\n" $PASS
printf "  FAILED: %d\n" $FAIL
echo "========================================"
[ $FAIL -eq 0 ] && echo "RESULT: PASSED" && exit 0 || echo "RESULT: FAILED" && exit 1
```

```bash
chmod +x tests/test_remote_control.sh
bash tests/test_remote_control.sh
```

Expected: all FAIL (nothing exists yet).

- [ ] **Step 2: Implement create-agent-labels.ps1**

Create `tools/create-agent-labels.ps1`:
```powershell
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
Write-Host "Labels ready. From phone: create issue → add label agent:<name> → agent runs." -ForegroundColor Cyan
```

- [ ] **Step 3: Run create-agent-labels.ps1**

```powershell
pwsh -File tools/create-agent-labels.ps1
```

Expected: all labels created or confirmed existing.

- [ ] **Step 4: Verify labels exist**

```bash
gh label list | grep "agent:"
```

Expected: 11 `agent:*` labels listed.

- [ ] **Step 5: Commit**

```bash
git add tools/create-agent-labels.ps1 tests/test_remote_control.sh
git commit -m "feat(remote): create-agent-labels.ps1 + remote control test scaffold"
```

---

## Task 2: GitHub Actions dispatch workflow

**Files:**
- Create: `.github/workflows/agent-dispatch.yml`

- [ ] **Step 1: Create workflow directory**

```bash
mkdir -p .github/workflows
```

- [ ] **Step 2: Implement agent-dispatch.yml**

Create `.github/workflows/agent-dispatch.yml`:
```yaml
name: Agent Dispatch

on:
  issues:
    types: [labeled]
  issue_comment:
    types: [created]

# Only one agent dispatch per issue at a time
concurrency:
  group: agent-dispatch-${{ github.event.issue.number }}
  cancel-in-progress: false

jobs:
  dispatch:
    runs-on: self-hosted
    # Trigger on agent:* label OR /agent <name> comment
    if: |
      (github.event_name == 'issues' &&
       startsWith(github.event.label.name, 'agent:')) ||
      (github.event_name == 'issue_comment' &&
       startsWith(github.event.comment.body, '/agent ') &&
       github.event.comment.user.login == github.repository_owner)

    steps:
      - name: Parse agent + task
        id: parse
        shell: pwsh
        run: |
          if ("${{ github.event_name }}" -eq "issues") {
            $agent = "${{ github.event.label.name }}" -replace "^agent:", ""
            $task  = @"
          ${{ github.event.issue.body }}
          "@
          } else {
            $comment = @"
          ${{ github.event.comment.body }}
          "@
            $parts = $comment.Trim() -split '\s+', 3
            $agent = $parts[1]
            $task  = if ($parts.Count -gt 2) { $parts[2] } else { "${{ github.event.issue.body }}" }
          }
          echo "agent=$agent" >> $env:GITHUB_OUTPUT
          $task | Out-File -FilePath "$env:RUNNER_TEMP\task.txt" -Encoding utf8

      - name: Post "running" acknowledgement
        uses: actions/github-script@v7
        with:
          script: |
            await github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
              body: `⚙️ **Agent \`${{ steps.parse.outputs.agent }}\` is running...** (started ${new Date().toISOString()})`
            });

      - name: Run agent (claude)
        id: run_claude
        shell: pwsh
        if: steps.parse.outputs.agent != ''
        run: |
          $task = Get-Content "$env:RUNNER_TEMP\task.txt" -Raw
          # claude -p runs in non-interactive print mode
          # Adjust flag if your claude version differs: claude --help | grep -A2 '\-p'
          $result = claude -p $task 2>&1
          $result | Out-File -FilePath "$env:RUNNER_TEMP\result.txt" -Encoding utf8
          echo "exit_code=$LASTEXITCODE" >> $env:GITHUB_OUTPUT
        continue-on-error: true

      - name: Post result
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const agent = '${{ steps.parse.outputs.agent }}';
            let result = '';
            try {
              result = fs.readFileSync(process.env.RUNNER_TEMP + '/result.txt', 'utf8');
            } catch (e) {
              result = `Error reading result: ${e.message}`;
            }
            // Truncate if too long for a comment (GitHub limit ~65535 chars)
            if (result.length > 60000) {
              result = result.slice(0, 60000) + '\n\n... (truncated — output exceeded limit)';
            }
            const exitCode = '${{ steps.run_claude.outputs.exit_code }}';
            const status = exitCode === '0' ? '✅' : '⚠️';
            await github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
              body: `${status} **Agent \`${agent}\` result:**\n\n\`\`\`\n${result}\n\`\`\``
            });

      - name: Remove dispatch label (reset for next use)
        if: github.event_name == 'issues'
        uses: actions/github-script@v7
        with:
          script: |
            try {
              await github.rest.issues.removeLabel({
                owner: context.repo.owner,
                repo: context.repo.repo,
                issue_number: context.issue.number,
                name: '${{ github.event.label.name }}'
              });
            } catch (e) {
              // Label already removed — ignore
            }
```

- [ ] **Step 3: Run remote control tests**

```bash
bash tests/test_remote_control.sh
```

Expected: label tests pass, workflow tests pass. (Runner online test skipped — runner setup is next task.)

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/agent-dispatch.yml
git commit -m "feat(remote): agent-dispatch GitHub Actions workflow"
```

---

## Task 3: Issue template for phone UX

**Files:**
- Create: `.github/ISSUE_TEMPLATE/agent-task.md`

- [ ] **Step 1: Create template**

Create `.github/ISSUE_TEMPLATE/agent-task.md`:
```markdown
---
name: Agent Task
about: Dispatch a task to an agent from your phone
title: '[TASK] '
labels: ''
assignees: ''
---

## Task

<!-- Describe what you want the agent to do. Be specific about the goal and success criteria. -->


## Context

<!-- Optional: relevant files, links, background the agent needs -->


## Agent

<!-- Add a label: agent:jarvis | agent:friday | agent:ultron | agent:sam | etc. -->
<!-- The agent runs automatically when you add the label. -->
```

- [ ] **Step 2: Commit**

```bash
git add .github/ISSUE_TEMPLATE/agent-task.md
git commit -m "feat(remote): issue template for phone-based agent dispatch"
```

---

## Task 4: Self-hosted runner setup script (one-time)

**Files:**
- Create: `tools/setup-runner.ps1`

- [ ] **Step 1: Implement setup-runner.ps1**

Create `tools/setup-runner.ps1`:
```powershell
#Requires -Version 5.1
<#
.SYNOPSIS
    One-time setup of a self-hosted GitHub Actions runner on this Windows machine.
    After running this, the runner starts as a Windows service (always-on).

.DESCRIPTION
    Downloads the runner, configures it against this repo, and installs as a
    Windows service so it survives reboots.

    PREREQUISITES:
    1. gh CLI authenticated: gh auth status
    2. You have admin rights on this machine (service install requires elevation)
    3. Repo is set in environment or passed as -RepoUrl

.PARAMETER RepoUrl
    GitHub repo URL, e.g. https://github.com/nathanjones/AgentSystem
    Defaults to reading from: gh repo view --json url -q .url

.PARAMETER RunnerDir
    Where to install the runner. Defaults to C:\actions-runner
#>
param(
    [string]$RepoUrl = "",
    [string]$RunnerDir = "C:\actions-runner"
)

$ErrorActionPreference = "Stop"

# Get repo URL if not provided
if (-not $RepoUrl) {
    $RepoUrl = gh repo view --json url -q .url 2>$null
    if (-not $RepoUrl) {
        Write-Error "Could not determine repo URL. Pass -RepoUrl https://github.com/owner/repo"
        exit 1
    }
}

Write-Host "Setting up self-hosted runner for: $RepoUrl" -ForegroundColor Cyan
Write-Host "Runner directory: $RunnerDir" -ForegroundColor Gray

# Create runner directory
if (-not (Test-Path $RunnerDir)) {
    New-Item -ItemType Directory -Force $RunnerDir | Out-Null
}

# Download latest runner
$apiUrl = "https://api.github.com/repos/actions/runner/releases/latest"
$latest = Invoke-RestMethod $apiUrl
$asset = $latest.assets | Where-Object { $_.name -like "*win-x64*.zip" } | Select-Object -First 1
if (-not $asset) {
    Write-Error "Could not find Windows x64 runner asset"
    exit 1
}

$zipPath = "$env:TEMP\actions-runner.zip"
Write-Host "  Downloading runner: $($asset.name)" -ForegroundColor Gray
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zipPath
Expand-Archive -Path $zipPath -DestinationPath $RunnerDir -Force
Remove-Item $zipPath

# Get registration token via gh CLI
Write-Host "  Getting registration token..." -ForegroundColor Gray
$repoPath = $RepoUrl -replace "https://github.com/", ""
$tokenResp = gh api -X POST "repos/$repoPath/actions/runners/registration-token" 2>$null | ConvertFrom-Json
if (-not $tokenResp.token) {
    Write-Error "Failed to get registration token. Ensure gh is authenticated with repo admin scope."
    exit 1
}

# Configure runner
Push-Location $RunnerDir
Write-Host "  Configuring runner..." -ForegroundColor Gray
& .\config.cmd `
    --url $RepoUrl `
    --token $tokenResp.token `
    --name "$env:COMPUTERNAME-agent-runner" `
    --labels "self-hosted,Windows,agent-runner" `
    --work "_work" `
    --unattended

# Install as Windows service
Write-Host "  Installing as Windows service..." -ForegroundColor Gray
& .\svc.sh install
& .\svc.sh start
Pop-Location

Write-Host ""
Write-Host "Runner installed and started as Windows service." -ForegroundColor Green
Write-Host "Verify at: $RepoUrl/settings/actions/runners"
Write-Host ""
Write-Host "Phone workflow:"
Write-Host "  1. Open GitHub mobile app"
Write-Host "  2. New Issue → use 'Agent Task' template"
Write-Host "  3. Add label: agent:friday (or any agent)"
Write-Host "  4. Watch for result comment notification"
```

- [ ] **Step 2: Commit**

```bash
git add tools/setup-runner.ps1
git commit -m "feat(remote): setup-runner.ps1 — one-time self-hosted runner install"
```

---

## Task 5: Run full test suite + end-to-end smoke test

- [ ] **Step 1: Run all test suites**

```bash
bash tests/test_memory_consistency.sh
node --test tests/test_graph.js
node --test tests/test_known_repos.js
bash tests/test_graph_integration.sh
bash tests/test_bootstrap.sh
bash tests/test_remote_control.sh
```

Expected: all pass. Note any SKIP for runner-online tests (runner must be installed separately).

- [ ] **Step 2: Set up runner (one-time, requires elevation)**

Open PowerShell as Administrator:
```powershell
pwsh -File tools/setup-runner.ps1
```

Verify runner is online:
```bash
gh api repos/:owner/:repo/actions/runners --jq '.runners[] | {name, status}'
```

Expected: runner with `status: "online"`.

- [ ] **Step 3: End-to-end smoke test from CLI (simulates phone)**

```bash
# Create a test issue and apply label — simulates what you'd do on phone
gh issue create \
  --title "[TEST] Smoke test agent dispatch" \
  --body "List the files in the AgentSystem repo root. Just the filenames, nothing else." \
  --label "agent:friday"
```

Wait ~30 seconds, then check for result comment:
```bash
# Get the issue number from the last step, replace 99 with actual number
gh issue view 99 --comments | tail -30
```

Expected: a comment from the GitHub Actions bot with the file listing result.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat(remote): complete remote control setup — runner, workflow, labels, templates"
```

---

## Phone UX Quick Reference (post-setup)

```
FIRE-AND-FORGET (async):
  GitHub mobile → Issues → New Issue
  → Title: what you want
  → Body: details + context
  → Label: agent:friday (or jarvis, sam, ultron, etc.)
  → Submit → wait for push notification with result

INTERACTIVE SESSION (real-time):
  Termius app → SSH → Windows machine
  → claude @friday    (full interactive session)
  → gemini            (Gemini CLI)
  → claude @jarvis    (CEO orchestration)

FOLLOW-UP IN EXISTING ISSUE:
  Add comment: /agent friday do this next thing
  (Only owner's comments trigger dispatch — security gate)
```
