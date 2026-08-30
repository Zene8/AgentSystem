---
description: Bulk-rename past Claude sessions using the haiku auto-namer
allowed-tools: Bash(node ~/dev/AgentSystem/tools/session-bulk-rename.js *)
argument-hint: [N | -1 for all] [--dry-run] [--force] [--jobs=N]
model: claude-haiku-4-5-20251001
---

Bulk-rename past Claude Code sessions. Wraps
`tools/session-bulk-rename.js`, which does the naming itself (one Haiku call
per session) — you do NOT generate names here.

## Your task

The user invoked: `/bulk-rename-sessions $ARGUMENTS`

1. **Parse the count.** First positional arg is the session count; `-1` means
   all. If `$ARGUMENTS` has no count, default to `10`.

2. **Always dry-run first** when the count is `-1` or greater than 25, so the
   user sees the plan and the spend before any model calls:

   ```
   node ~/dev/AgentSystem/tools/session-bulk-rename.js <N> --dry-run
   ```

   Report the plan (how many would be renamed / skipped) and ask for
   confirmation before the real run.

3. **Run it.** Forward the user's flags verbatim; add `--yes` only after the
   user has confirmed a large run.

   ```
   node ~/dev/AgentSystem/tools/session-bulk-rename.js <N> [--force] [--jobs=N] [--yes]
   ```

4. **Report** the tool's final summary line (renamed / skipped / failed)
   verbatim. Do not re-summarize per session.

## Flags

- `--dry-run` — print the plan, zero model calls.
- `--force` — ignore the eligibility filter (re-renames sessions that already
  have an autorename marker or a manual `/rename-session` name).
- `--jobs=N` — concurrency, default 4.
- `--yes` — skip the confirm prompt for large runs.

## Where the name shows up

The tool writes both halves of the name:

1. The session registry (`~/agent-memory/nexus/session-registry.jsonl`).
2. The **native Claude Code title**, appended to the session's own transcript
   as `custom-title` / `agent-name` sidecar lines — the same lines the harness
   writes, last one wins.

So a renamed session shows its new name in the session picker without waiting
for a start or resume. If the transcript file is gone, the registry is still
updated and the tool says `(registry only - no transcript found)` for that
session.
