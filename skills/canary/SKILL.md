---
name: canary
description: >
  End-to-end pipeline self-test — create a throwaway issue, branch, and
  draft PR in a designated sandbox repo, verify labels and audit hooks fire,
  then report any broken link in the chain. Triggers on "run the canary",
  "test the pipeline end to end", "canary check", "is the dispatch pipeline
  healthy". Never run against a production repo — sandbox only.
---

## Guardrail — confirm the target repo first

This creates real issues/branches/PRs. Only run against a designated sandbox repo (ask the user which one if not already configured; never assume the working repo is safe to canary against production issues/PRs).

## Procedure

1. **Create a canary issue**:
   ```bash
   gh issue create --repo <sandbox-repo> --title "[canary] pipeline self-test $(date -u +%Y-%m-%dT%H:%M:%SZ)" \
     --body "Automated canary — safe to ignore/close." --label "implementation"
   ```
   Capture the returned issue number `N`.
2. **Branch and push**:
   ```bash
   git -C <sandbox-repo-path> checkout -b issue-N-canary
   git -C <sandbox-repo-path> commit --allow-empty -m "canary: pipeline self-test"
   git -C <sandbox-repo-path> push -u origin issue-N-canary
   ```
3. **Open a draft PR**:
   ```bash
   gh pr create --repo <sandbox-repo> --base main --head issue-N-canary --draft \
     --title "[canary] pipeline self-test" --body "Closes #N"
   ```
4. **Verify each pipeline link fires**, polling with short waits (no long sleeps — check, wait a bounded interval, recheck):
   - Label auto-applied?  `gh pr view <PR> --repo <sandbox-repo> --json labels`
   - CI/checks triggered? `gh pr checks <PR> --repo <sandbox-repo>`
   - Sam-audit workflow queued/ran? `gh run list --repo <sandbox-repo> --workflow=sam-audit.yml --limit 3`
   - Self-hosted runner alive? `gh api repos/<owner>/<sandbox-repo>/actions/runners`
5. **Clean up**: close the PR and issue, delete the branch — canary artifacts must not linger.
   ```bash
   gh pr close <PR> --repo <sandbox-repo> --delete-branch
   gh issue close N --repo <sandbox-repo> --comment "canary complete"
   ```
6. **Report** a pass/fail line per link checked in step 4 — any missing/no-op link is the finding, not just "pipeline OK."
