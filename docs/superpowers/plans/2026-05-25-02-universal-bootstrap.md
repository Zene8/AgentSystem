# Universal Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A single PowerShell script that bootstraps any repo on any machine — installs deps, injects CLAUDE.md context, runs graph-init, and registers the repo in a global known-repos registry.

**Architecture:** `bootstrap-repo.ps1` is idempotent and self-contained. It shells out to `graph-init.js` (from sub-project 1) and writes to `known-repos.json` in the user-global agent-memory directory. CLAUDE.md injection appends a block that never duplicates.

**Tech Stack:** PowerShell 5.1+, Node.js (graph-init), git

**Prerequisite:** Sub-project 1 (dual-brain graph) must be complete. `tools/graph/graph-init.js` must exist.

---

## File Map

| File | Purpose |
|------|---------|
| `tools/bootstrap-repo.ps1` | Main bootstrap script — idempotent, any repo |
| `tools/claude-md-block.txt` | Template for CLAUDE.md injection block |
| `tests/test_bootstrap.sh` | Integration tests for bootstrap idempotency + registry |

---

## Task 1: `known-repos.json` schema + init helper

**Files:**
- Create: `tools/graph/known-repos.js`
- Create: `tests/test_known_repos.js`

- [ ] **Step 1: Write failing unit tests**

Create `tests/test_known_repos.js`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';
import { readRegistry, writeRegistry, upsertRepo, findRepo } from '../tools/graph/known-repos.js';

function tmp() {
  const d = join(tmpdir(), `kr-test-${Date.now()}`);
  mkdirSync(d, { recursive: true });
  return d;
}

test('readRegistry returns empty registry if file missing', () => {
  const dir = tmp();
  const reg = readRegistry(join(dir, 'known-repos.json'));
  assert.equal(reg.version, '1.0');
  assert.deepEqual(reg.repos, []);
  rmSync(dir, { recursive: true });
});

test('upsertRepo adds new entry', () => {
  const dir = tmp();
  const path = join(dir, 'known-repos.json');
  let reg = readRegistry(path);
  reg = upsertRepo(reg, { slug: 'myrepo', path: '/tmp/myrepo', primary_cli: 'claude' });
  assert.equal(reg.repos.length, 1);
  assert.equal(reg.repos[0].slug, 'myrepo');
  assert.equal(reg.repos[0].bootstrap_complete, true);
  rmSync(dir, { recursive: true });
});

test('upsertRepo updates existing entry (idempotent)', () => {
  const dir = tmp();
  const path = join(dir, 'known-repos.json');
  let reg = readRegistry(path);
  reg = upsertRepo(reg, { slug: 'myrepo', path: '/tmp/myrepo', primary_cli: 'claude' });
  reg = upsertRepo(reg, { slug: 'myrepo', path: '/tmp/myrepo-new', primary_cli: 'gemini' });
  assert.equal(reg.repos.length, 1);
  assert.equal(reg.repos[0].path, '/tmp/myrepo-new');
  assert.equal(reg.repos[0].primary_cli, 'gemini');
  rmSync(dir, { recursive: true });
});

test('findRepo returns entry by slug', () => {
  const dir = tmp();
  const path = join(dir, 'known-repos.json');
  let reg = readRegistry(path);
  reg = upsertRepo(reg, { slug: 'target', path: '/a', primary_cli: 'claude' });
  reg = upsertRepo(reg, { slug: 'other', path: '/b', primary_cli: 'claude' });
  const found = findRepo(reg, 'target');
  assert.equal(found.path, '/a');
  assert.equal(findRepo(reg, 'nope'), null);
  rmSync(dir, { recursive: true });
});

test('writeRegistry + readRegistry round-trip', () => {
  const dir = tmp();
  const path = join(dir, 'known-repos.json');
  let reg = readRegistry(path);
  reg = upsertRepo(reg, { slug: 'rt', path: '/rt', primary_cli: 'claude' });
  writeRegistry(path, reg);
  const loaded = readRegistry(path);
  assert.equal(loaded.repos.length, 1);
  assert.equal(loaded.repos[0].slug, 'rt');
  rmSync(dir, { recursive: true });
});
```

```bash
node --test tests/test_known_repos.js 2>&1 | head -10
```

Expected: `Cannot find module '../tools/graph/known-repos.js'`

- [ ] **Step 2: Implement known-repos.js**

Create `tools/graph/known-repos.js`:
```javascript
// known-repos.js — global registry of bootstrapped repos
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

export function readRegistry(registryPath) {
  if (!existsSync(registryPath)) return { version: '1.0', repos: [] };
  return JSON.parse(readFileSync(registryPath, 'utf8'));
}

export function writeRegistry(registryPath, registry) {
  mkdirSync(dirname(registryPath), { recursive: true });
  writeFileSync(registryPath, JSON.stringify(registry, null, 2) + '\n', 'utf8');
}

export function upsertRepo(registry, entry) {
  const today = new Date().toISOString().slice(0, 10);
  const record = {
    slug: entry.slug,
    path: entry.path,
    brain_path: entry.brain_path ?? `nexus/${entry.slug}/graph.json`,
    last_init: today,
    primary_cli: entry.primary_cli ?? 'claude',
    bootstrap_complete: true,
  };
  const existing = registry.repos.findIndex(r => r.slug === entry.slug);
  if (existing >= 0) {
    const repos = [...registry.repos];
    repos[existing] = { ...repos[existing], ...record };
    return { ...registry, repos };
  }
  return { ...registry, repos: [...registry.repos, record] };
}

export function findRepo(registry, slug) {
  return registry.repos.find(r => r.slug === slug) ?? null;
}
```

- [ ] **Step 3: Run unit tests**

```bash
node --test tests/test_known_repos.js
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add tools/graph/known-repos.js tests/test_known_repos.js
git commit -m "feat(bootstrap): known-repos registry — read/write/upsert/find"
```

---

## Task 2: CLAUDE.md injection template

**Files:**
- Create: `tools/claude-md-block.txt`

- [ ] **Step 1: Create injection template**

Create `tools/claude-md-block.txt`:
```
<!-- AGENT-SYSTEM-BOOTSTRAP: do not remove this block -->
## Agent System Context (auto-injected by bootstrap-repo.ps1)

- Agent routing: see `~/.claude/CLAUDE.md`
- Agent brain: `~/.claude/agent-memory/nexus/agent-brain/`
- Repo brain: `nexus/{{SLUG}}/` (run `node tools/graph/graph-init.js {{SLUG}} .` to refresh)
- Query graph: `node tools/graph/graph-query.js {{SLUG}} <keywords>`
- Update weights: `node tools/graph/graph-weight.js visit {{SLUG}} <source> <target>`
- Known repos: `~/.claude/agent-memory/nexus/known-repos.json`
<!-- END AGENT-SYSTEM-BOOTSTRAP -->
```

- [ ] **Step 2: Commit**

```bash
git add tools/claude-md-block.txt
git commit -m "chore: CLAUDE.md injection template for bootstrap"
```

---

## Task 3: Main bootstrap script (`bootstrap-repo.ps1`)

**Files:**
- Create: `tools/bootstrap-repo.ps1`
- Create: `tests/test_bootstrap.sh`

- [ ] **Step 1: Write failing integration test**

Create `tests/test_bootstrap.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
PASS=0; FAIL=0
ok()   { echo "[PASS] $1"; ((PASS++)); }
fail() { echo "[FAIL] $1"; ((FAIL++)); }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_REPO_DIR="/tmp/test-bootstrap-repo-$(date +%s)"
REGISTRY="$HOME/.claude/agent-memory/nexus/known-repos.json"

cleanup() {
  rm -rf "$TEST_REPO_DIR"
  # Remove test entry from registry if it exists
  if [ -f "$REGISTRY" ]; then
    node -e "
      const fs=require('fs');
      const reg=JSON.parse(fs.readFileSync('$REGISTRY','utf8'));
      reg.repos=reg.repos.filter(r=>r.slug!=='test-bootstrap-target');
      fs.writeFileSync('$REGISTRY',JSON.stringify(reg,null,2)+'\n','utf8');
    " 2>/dev/null || true
  fi
}
trap cleanup EXIT

echo "=== Setup: create minimal test repo ==="
mkdir -p "$TEST_REPO_DIR"
cd "$TEST_REPO_DIR"
git init -q
git config user.email "test@test.com"
git config user.name "Test"
echo "# Test Repo" > README.md
echo "console.log('hello')" > index.js
git add . && git commit -q -m "initial"
cd "$REPO_ROOT"

echo "=== Test: bootstrap-repo.ps1 runs without error ==="
pwsh -File "$REPO_ROOT/tools/bootstrap-repo.ps1" \
  -RepoPath "$TEST_REPO_DIR" \
  -Slug "test-bootstrap-target" \
  -PrimaryCli "claude" 2>/dev/null \
  && ok "bootstrap exits 0" || fail "bootstrap exited non-zero"

echo "=== Test: repo brain created ==="
[ -f "$TEST_REPO_DIR/nexus/test-bootstrap-target/graph.json" ] \
  && ok "repo brain graph.json created" \
  || fail "repo brain graph.json missing"

echo "=== Test: CLAUDE.md injected ==="
[ -f "$TEST_REPO_DIR/CLAUDE.md" ] && ok "CLAUDE.md exists" || fail "CLAUDE.md missing"
grep -q "AGENT-SYSTEM-BOOTSTRAP" "$TEST_REPO_DIR/CLAUDE.md" \
  && ok "CLAUDE.md has agent block" || fail "CLAUDE.md missing agent block"

echo "=== Test: registry entry created ==="
node -e "
  const fs=require('fs');
  const reg=JSON.parse(fs.readFileSync('$REGISTRY','utf8'));
  const entry=reg.repos.find(r=>r.slug==='test-bootstrap-target');
  if (!entry) { console.error('not found'); process.exit(1); }
  console.log('found');
" 2>/dev/null && ok "registry entry exists" || fail "registry entry missing"

echo "=== Test: bootstrap is idempotent ==="
pwsh -File "$REPO_ROOT/tools/bootstrap-repo.ps1" \
  -RepoPath "$TEST_REPO_DIR" \
  -Slug "test-bootstrap-target" \
  -PrimaryCli "claude" 2>/dev/null \
  && ok "second run exits 0" || fail "second run failed"

BLOCK_COUNT=$(grep -c "AGENT-SYSTEM-BOOTSTRAP" "$TEST_REPO_DIR/CLAUDE.md" 2>/dev/null || echo "0")
[ "$BLOCK_COUNT" -eq 1 ] && ok "CLAUDE.md block not duplicated" || fail "CLAUDE.md block duplicated ($BLOCK_COUNT times)"

REGISTRY_COUNT=$(node -e "
  const fs=require('fs');
  const reg=JSON.parse(fs.readFileSync('$REGISTRY','utf8'));
  console.log(reg.repos.filter(r=>r.slug==='test-bootstrap-target').length);
" 2>/dev/null)
[ "$REGISTRY_COUNT" -eq 1 ] && ok "registry entry not duplicated" || fail "registry entry duplicated ($REGISTRY_COUNT times)"

echo ""
echo "========================================"
printf "  PASSED: %d\n" $PASS
printf "  FAILED: %d\n" $FAIL
echo "========================================"
[ $FAIL -eq 0 ] && echo "RESULT: PASSED" && exit 0 || echo "RESULT: FAILED" && exit 1
```

```bash
chmod +x tests/test_bootstrap.sh
bash tests/test_bootstrap.sh
```

Expected: FAIL — `bootstrap-repo.ps1` not found.

- [ ] **Step 2: Implement bootstrap-repo.ps1**

Create `tools/bootstrap-repo.ps1`:
```powershell
#Requires -Version 5.1
<#
.SYNOPSIS
    Bootstrap any repo for the AgentSystem. Idempotent — safe to re-run.
.PARAMETER RepoPath
    Path to the repo to bootstrap. Defaults to current directory.
.PARAMETER Slug
    Short identifier for this repo (used as brain key). Defaults to dirname.
.PARAMETER PrimaryCli
    Which CLI to use as primary: claude, gemini, copilot. Defaults to claude.
.PARAMETER SkipGraphInit
    Skip running graph-init (useful if repo has no git history yet).
.EXAMPLE
    pwsh -File tools/bootstrap-repo.ps1 -RepoPath C:\projects\myrepo
#>
param(
    [string]$RepoPath = (Get-Location).Path,
    [string]$Slug = "",
    [string]$PrimaryCli = "claude",
    [switch]$SkipGraphInit
)

$ErrorActionPreference = "Stop"
$RepoPath = Resolve-Path $RepoPath

# Derive slug from directory name if not provided
if (-not $Slug) {
    $Slug = (Split-Path $RepoPath -Leaf) -replace '[^a-zA-Z0-9]', '-' | ForEach-Object { $_.ToLower() }
}

$AgentSystemRoot = Split-Path $PSScriptRoot -Parent
$RegistryPath    = "$env:USERPROFILE\.claude\agent-memory\nexus\known-repos.json"
$TemplateFile    = "$PSScriptRoot\claude-md-block.txt"
$GraphInitScript = "$PSScriptRoot\graph\graph-init.js"
$KnownReposLib   = "$PSScriptRoot\graph\known-repos.js"
$ClaudeMdPath    = Join-Path $RepoPath "CLAUDE.md"

Write-Host "Bootstrap: $Slug @ $RepoPath" -ForegroundColor Cyan

# ── Step 1: Verify git repo ──────────────────────────────────────────────────
if (-not (Test-Path (Join-Path $RepoPath ".git"))) {
    Write-Warning "Not a git repo: $RepoPath. Skipping git-dependent steps."
    $SkipGraphInit = $true
}

# ── Step 2: Detect project type + install deps ───────────────────────────────
if (Test-Path (Join-Path $RepoPath "package.json")) {
    Write-Host "  Detected: Node.js — running npm install" -ForegroundColor Gray
    Push-Location $RepoPath
    try { npm install --silent 2>$null } catch { Write-Warning "npm install failed (non-fatal)" }
    Pop-Location
}
if (Test-Path (Join-Path $RepoPath "requirements.txt")) {
    Write-Host "  Detected: Python — running pip install" -ForegroundColor Gray
    try { pip install -r (Join-Path $RepoPath "requirements.txt") -q 2>$null } catch { Write-Warning "pip install failed (non-fatal)" }
}
if (Test-Path (Join-Path $RepoPath "go.mod")) {
    Write-Host "  Detected: Go — running go mod download" -ForegroundColor Gray
    Push-Location $RepoPath
    try { go mod download 2>$null } catch { Write-Warning "go mod download failed (non-fatal)" }
    Pop-Location
}

# ── Step 3: Inject CLAUDE.md block (idempotent) ──────────────────────────────
$BlockMarker = "AGENT-SYSTEM-BOOTSTRAP"
$AlreadyInjected = $false
if (Test-Path $ClaudeMdPath) {
    $existing = Get-Content $ClaudeMdPath -Raw
    if ($existing -match $BlockMarker) { $AlreadyInjected = $true }
}

if (-not $AlreadyInjected) {
    $template = Get-Content $TemplateFile -Raw
    $block = $template -replace '\{\{SLUG\}\}', $Slug
    if (Test-Path $ClaudeMdPath) {
        Add-Content $ClaudeMdPath "`n$block"
    } else {
        Set-Content $ClaudeMdPath "# $Slug`n`n$block" -Encoding utf8
    }
    Write-Host "  Injected agent block into CLAUDE.md" -ForegroundColor Green
} else {
    Write-Host "  CLAUDE.md already has agent block (skipped)" -ForegroundColor Gray
}

# ── Step 4: Run graph-init ───────────────────────────────────────────────────
if (-not $SkipGraphInit) {
    if (Test-Path $GraphInitScript) {
        Write-Host "  Running graph-init for: $Slug" -ForegroundColor Gray
        Push-Location $RepoPath
        try {
            node $GraphInitScript $Slug $RepoPath
        } catch {
            Write-Warning "graph-init failed (non-fatal): $_"
        }
        Pop-Location
    } else {
        Write-Warning "graph-init.js not found at $GraphInitScript — skipping"
    }
} else {
    Write-Host "  Skipping graph-init (--SkipGraphInit)" -ForegroundColor Gray
}

# ── Step 5: Register in known-repos.json ─────────────────────────────────────
$brainPath = "nexus/$Slug/graph.json"
$entry = @{
    slug             = $Slug
    path             = $RepoPath -replace '\\', '/'
    brain_path       = $brainPath
    primary_cli      = $PrimaryCli
}

# Use node to update registry (avoids PS JSON quirks with arrays)
$entryJson = $entry | ConvertTo-Json -Compress
node -e @"
import { readRegistry, writeRegistry, upsertRepo } from '$($KnownReposLib -replace '\\', '/')';
const reg = readRegistry('$($RegistryPath -replace '\\', '/')');
const updated = upsertRepo(reg, $entryJson);
writeRegistry('$($RegistryPath -replace '\\', '/')', updated);
console.log('Registered: $Slug');
"@ 2>$null
if ($LASTEXITCODE -ne 0) {
    # Fallback: pure PowerShell registry update
    $regDir = Split-Path $RegistryPath -Parent
    if (-not (Test-Path $regDir)) { New-Item -ItemType Directory -Force $regDir | Out-Null }
    $registry = if (Test-Path $RegistryPath) {
        Get-Content $RegistryPath -Raw | ConvertFrom-Json
    } else {
        [PSCustomObject]@{ version = "1.0"; repos = @() }
    }
    $repos = [System.Collections.ArrayList]$registry.repos
    $existingIdx = $repos.FindIndex({ param($r) $r.slug -eq $Slug })
    $record = [PSCustomObject]@{
        slug              = $Slug
        path              = $RepoPath -replace '\\', '/'
        brain_path        = $brainPath
        last_init         = (Get-Date -Format "yyyy-MM-dd")
        primary_cli       = $PrimaryCli
        bootstrap_complete = $true
    }
    if ($existingIdx -ge 0) { $repos[$existingIdx] = $record }
    else { $repos.Add($record) | Out-Null }
    $registry.repos = $repos.ToArray()
    $registry | ConvertTo-Json -Depth 5 | Set-Content $RegistryPath -Encoding utf8
    Write-Host "  Registered (PS fallback): $Slug" -ForegroundColor Green
}

# ── Step 6: Verify CLIs ──────────────────────────────────────────────────────
foreach ($cli in @("claude", "gemini", "copilot")) {
    $found = Get-Command $cli -ErrorAction SilentlyContinue
    if ($found) {
        Write-Host "  CLI: $cli ✓" -ForegroundColor Green
    } else {
        Write-Warning "  CLI: $cli not found (install for full agent support)"
    }
}

Write-Host ""
Write-Host "Bootstrap complete: $Slug" -ForegroundColor Cyan
Write-Host "  Repo:   $RepoPath"
Write-Host "  Brain:  $RepoPath\nexus\$Slug\"
Write-Host "  Query:  node tools/graph/graph-query.js $Slug <keywords>"
```

- [ ] **Step 3: Run integration tests**

```bash
bash tests/test_bootstrap.sh
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add tools/bootstrap-repo.ps1 tools/claude-md-block.txt tests/test_bootstrap.sh
git commit -m "feat(bootstrap): bootstrap-repo.ps1 — idempotent any-repo setup"
```

---

## Task 4: Register AgentSystem itself

- [ ] **Step 1: Bootstrap the AgentSystem repo**

```powershell
pwsh -File tools/bootstrap-repo.ps1 -RepoPath . -Slug "agentsystem" -PrimaryCli "claude"
```

Expected output:
```
Bootstrap: agentsystem @ C:\Users\natha\AgentSystem
  Detected: (no package.json — skip)
  CLAUDE.md already has agent block (skipped)
  Running graph-init for: agentsystem
  graph-init: XX nodes, XX edges → nexus/agentsystem/
  Registered: agentsystem
  CLI: claude ✓
  ...
Bootstrap complete: agentsystem
```

- [ ] **Step 2: Verify registry**

```bash
node -e "
const fs = require('fs');
const reg = JSON.parse(fs.readFileSync(process.env.USERPROFILE + '/.claude/agent-memory/nexus/known-repos.json', 'utf8'));
console.log(JSON.stringify(reg, null, 2));
"
```

Expected: entry for `agentsystem` with `bootstrap_complete: true`.

- [ ] **Step 3: Run full test suite**

```bash
bash tests/test_memory_consistency.sh && node --test tests/test_graph.js && node --test tests/test_known_repos.js && bash tests/test_graph_integration.sh && bash tests/test_bootstrap.sh
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(bootstrap): self-bootstrap agentsystem + registry entry"
```
