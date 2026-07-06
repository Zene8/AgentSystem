# CLI Memory Sync Verification Guide

**Last Updated:** 2026-05-21  
**Purpose:** Verify memory system is synchronized across all 3 CLIs (Claude Code, Gemini, Copilot)

---

## Quick Health Check

Run this to verify memory sync across all platforms in <2 minutes:

```bash
# From project root, run sync script
powershell -File sync_agents_from_repo.ps1

# Then verify all 3 CLIs have the same memory files
echo "=== Claude Code ===" && ls -la .claude/memory/ 2>/dev/null | grep -E "\.md$"
echo "=== Copilot ===" && ls -la .copilot/memory/ 2>/dev/null | grep -E "\.md$"
echo "=== Gemini ===" && ls -la .gemini/antigravity-cli/memory/ 2>/dev/null | grep -E "\.md$"
```

**Expected output:** All 3 CLIs should show identical memory files (4 files):
- `friday.md`
- `jarvis.md`
- `nat.md`
- `sam.md`

---

## Detailed Verification Steps

### Step 1: Verify Master Memory Files Exist

```bash
# Check .agents/memory/ has all 4 files
ls -la .agents/memory/
```

Expected:
```
-rw-r--r-- 1 natha 197609 1534 May 21 03:29 friday.md
-rw-r--r-- 1 natha 197609 2096 May 21 03:29 jarvis.md
-rw-r--r-- 1 natha 197609  893 May 21 03:29 nat.md
-rw-r--r-- 1 natha 197609 1345 May 21 03:29 sam.md
```

If any files missing → Add them and commit:
```bash
git add .agents/memory/*.md
git commit -m "feat(memory): add missing decision logs"
```

---

### Step 2: Run Sync Script

```bash
# From project root:
powershell -File sync_agents_from_repo.ps1
```

Look for output:
```
[2026-05-21 03:29:21] [SUCCESS] Agent definition sync complete!
[2026-05-21 03:29:21] [SUCCESS] Verification: All 10 agents synced to all 3 platforms
```

If sync fails → Check error output, verify master agent files exist in `.agents/agents/`

---

### Step 3: Verify Claude Code Memory Sync

```bash
# Check if .claude/ has memory directory
test -d .claude/memory && echo "✅ Memory directory exists" || echo "❌ Memory directory missing"

# List memory files in Claude Code config
ls -la .claude/memory/ 2>/dev/null || echo "Memory directory not found in .claude/"
```

Expected: 4 files (friday.md, jarvis.md, nat.md, sam.md) in `.claude/memory/`

**Manual fix if needed:**
```bash
cp -r .agents/memory/* .claude/memory/
```

---

### Step 4: Verify Copilot Memory Sync

```bash
# Check if .copilot/ has memory directory
test -d .copilot/memory && echo "✅ Memory directory exists" || echo "❌ Memory directory missing"

# List memory files in Copilot config
ls -la .copilot/memory/ 2>/dev/null || echo "Memory directory not found in .copilot/"
```

Expected: 4 files (friday.md, jarvis.md, nat.md, sam.md) in `.copilot/memory/`

**Manual fix if needed:**
```bash
cp -r .agents/memory/* .copilot/memory/
```

---

### Step 5: Verify Gemini Memory Sync

```bash
# Check if .gemini/antigravity-cli/ has memory directory
test -d .gemini/antigravity-cli/memory && echo "✅ Memory directory exists" || echo "❌ Memory directory missing"

# List memory files in Gemini config
ls -la .gemini/antigravity-cli/memory/ 2>/dev/null || echo "Memory directory not found in .gemini/"
```

Expected: 4 files (friday.md, jarvis.md, nat.md, sam.md) in `.gemini/antigravity-cli/memory/`

**Manual fix if needed:**
```bash
cp -r .agents/memory/* .gemini/antigravity-cli/memory/
```

---

### Step 6: Verify File Content Consistency

Check that memory files are identical across all CLIs (skip format conversions like JSON):

```bash
# Compare Claude Code vs Master (should be identical)
diff .agents/memory/jarvis.md .claude/memory/jarvis.md && echo "✅ Jarvis memory synced (Claude Code)"

# Compare Copilot vs Master (should be identical)
diff .agents/memory/jarvis.md .copilot/memory/jarvis.md && echo "✅ Jarvis memory synced (Copilot)"

# Compare Gemini vs Master (should be identical)
diff .agents/memory/jarvis.md .gemini/antigravity-cli/memory/jarvis.md && echo "✅ Jarvis memory synced (Gemini)"
```

If diffs exist → Re-run sync script:
```bash
powershell -File sync_agents_from_repo.ps1
```

---

### Step 7: Verify Agent Definition Sync (Regression Check)

While you're at it, verify agents are also synced (double-check from earlier commits):

```bash
# Count agents in each location
echo "Master (.agents/agents/): $(ls .agents/agents/*.md | wc -l)"
echo "Claude Code (.claude/agents/): $(ls .claude/agents/*.md 2>/dev/null | wc -l)"
echo "Copilot (.copilot/agents/): $(ls .copilot/agents/*.md 2>/dev/null | wc -l)"
echo "Gemini (.gemini/antigravity-cli/agent/): $(ls .gemini/antigravity-cli/agent/*.json 2>/dev/null | wc -l)"
```

Expected: All should show `10` agents.

---

## Automated Health Check

Create a shell script to run all checks automatically:

```bash
# Save as verify_memory_sync.sh
#!/bin/bash

set -e

echo "🔍 Verifying memory sync across all 3 CLIs..."
echo ""

# Run sync
echo "1️⃣  Running sync script..."
powershell -File sync_agents_from_repo.ps1 > /dev/null 2>&1 && echo "   ✅ Sync script completed" || echo "   ❌ Sync script failed"

# Check master
echo "2️⃣  Checking master .agents/memory/..."
if [ -d .agents/memory/ ]; then
  count=$(ls .agents/memory/*.md 2>/dev/null | wc -l)
  echo "   ✅ Found $count memory files in .agents/memory/"
else
  echo "   ❌ .agents/memory/ directory missing"
  exit 1
fi

# Check Claude Code
echo "3️⃣  Checking Claude Code .claude/memory/..."
if [ -d .claude/memory/ ]; then
  count=$(ls .claude/memory/*.md 2>/dev/null | wc -l)
  echo "   ✅ Found $count memory files in .claude/memory/"
else
  echo "   ❌ .claude/memory/ missing (will be synced next run)"
fi

# Check Copilot
echo "4️⃣  Checking Copilot .copilot/memory/..."
if [ -d .copilot/memory/ ]; then
  count=$(ls .copilot/memory/*.md 2>/dev/null | wc -l)
  echo "   ✅ Found $count memory files in .copilot/memory/"
else
  echo "   ❌ .copilot/memory/ missing (will be synced next run)"
fi

# Check Gemini
echo "5️⃣  Checking Gemini .gemini/antigravity-cli/memory/..."
if [ -d .gemini/antigravity-cli/memory/ ]; then
  count=$(ls .gemini/antigravity-cli/memory/*.md 2>/dev/null | wc -l)
  echo "   ✅ Found $count memory files in .gemini/antigravity-cli/memory/"
else
  echo "   ❌ .gemini/antigravity-cli/memory/ missing (will be synced next run)"
fi

echo ""
echo "✅ Memory sync verification complete!"
```

Run with:
```bash
bash verify_memory_sync.sh
```

---

## Troubleshooting

### Issue: Memory files not syncing

**Symptom:** After running sync script, `.claude/memory/` or `.copilot/memory/` are empty

**Cause 1:** Master files in `.agents/memory/` don't exist or sync script skipped memory copy

**Fix:**
```bash
# Verify master memory exists
ls .agents/memory/

# If missing, check git:
git log --oneline .agents/memory/ | head -5

# If truly missing, restore from git:
git restore .agents/memory/

# Then re-run sync:
powershell -File sync_agents_from_repo.ps1
```

**Cause 2:** Sync script has a bug in memory copy logic

**Workaround — Manual copy:**
```bash
# Copy memory to all CLIs manually
cp -r .agents/memory/* .claude/memory/
cp -r .agents/memory/* .copilot/memory/
cp -r .agents/memory/* .gemini/antigravity-cli/memory/
```

---

### Issue: Memory files out of sync

**Symptom:** `diff` shows differences between `.agents/memory/` and CLI configs

**Cause:** Sync script didn't run after memory was updated

**Fix:** Re-run sync script and force copy:
```bash
powershell -File sync_agents_from_repo.ps1

# If still different, manually copy:
cp .agents/memory/*.md .claude/memory/
cp .agents/memory/*.md .copilot/memory/
cp .agents/memory/*.md .gemini/antigravity-cli/memory/

# Then verify:
diff .agents/memory/jarvis.md .claude/memory/jarvis.md
```

---

### Issue: Memory accessible in one CLI but not others

**Symptom:** Memory works in Claude Code but missing in Copilot/Gemini

**Cause:** Partial sync or CLI config directory structure issue

**Fix:** Full re-sync with explicit verification:
```bash
# Run sync with verbose output
powershell -File sync_agents_from_repo.ps1

# Manually verify all directories exist
mkdir -p .claude/memory
mkdir -p .copilot/memory
mkdir -p .gemini/antigravity-cli/memory

# Copy all memory files
cp .agents/memory/*.md .claude/memory/
cp .agents/memory/*.md .copilot/memory/
cp .agents/memory/*.md .gemini/antigravity-cli/memory/

# Re-run sync to finish
powershell -File sync_agents_from_repo.ps1
```

---

## Maintenance Schedule

| Task | Frequency | Owner |
|------|-----------|-------|
| **Verify memory sync** | Weekly (before Sat cadence) | Jarvis |
| **Update decision logs** | After each major decision | Leadership tier agents |
| **Check sync script** | Monthly (spot-check 2 agents) | Friday (CTO) |
| **Full audit** | Quarterly | Sam (CSO) security audit |

---

## For Agents: Accessing Memory at Session Start

When you initialize in any CLI, check memory like this:

```bash
# Claude Code or any bash environment
cat .agents/memory/jarvis.md      # CEO decisions
cat .agents/memory/friday.md      # CTO discipline
cat .agents/memory/sam.md         # CSO audit log
cat .agents/memory/nat.md         # CBO business decisions
```

All 4 files should be identical regardless of CLI. If one is missing or stale:

1. **Alert:** Notify about missing memory
2. **Recovery:** Ask human to run `powershell -File sync_agents_from_repo.ps1`
3. **Fallback:** Read from master `.agents/memory/` directly if CLI copy is stale

---

## Summary

✅ **Healthy memory sync = all 3 CLIs have identical 4 memory files**

Verify weekly before Jarvis Saturday cadence review.
