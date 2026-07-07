---
name: stale-sweep
description: >
  Deterministic sweep for stale branches, orphan worktrees, unlabeled
  issues, and zombie PRs, with an optional cleanup step. Triggers on "stale
  sweep", "clean up branches", "find orphan worktrees", "stale-sweep",
  "housekeeping check".
---

## Procedure — report first, clean up only on explicit confirmation

1. **Stale branches** (merged but not deleted, or no commits in 30+ days):
   ```bash
   git fetch --prune
   git branch -r --merged origin/main
   git for-each-ref --format='%(refname:short) %(committerdate:iso8601)' refs/heads/ | awk -v d="$(date -d '-30 days' +%Y-%m-%d)" '$2 < d'
   ```
2. **Orphan worktrees** (registered but path missing, or path exists but branch long-dead):
   ```bash
   git worktree list
   git worktree prune --dry-run
   ```
3. **Unlabeled issues**:
   ```bash
   gh issue list --state=open --json number,title,labels | node -e "const d=JSON.parse(require('fs').readFileSync(0));console.log(d.filter(i=>!i.labels.length))"
   ```
4. **Zombie PRs** (open, no activity in 14+ days, or draft with all-green CI sitting unmerged):
   ```bash
   gh pr list --state=open --json number,title,updatedAt,isDraft,statusCheckRollup
   ```
5. **Report** each category as a table: item, age/reason, suggested action (delete branch / prune worktree / add label / ping owner / mark ready).
6. **Cleanup is opt-in** — do not delete branches, prune worktrees, or close PRs without the user explicitly confirming the specific list. When confirmed, use the safe form (`git worktree prune` without `--dry-run`, `git push origin --delete <branch>`), never `-D`/`--force` unless the user explicitly asks for it.
