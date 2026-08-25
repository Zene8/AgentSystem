# Harness support matrix

Which AgentSystem features actually work on which host CLI. Every feature is `supported`,
`unsupported-by-design`, or `gap` — there is no fourth state and no blank cell. A cell that is not
`supported` carries a reason.

Hosts: **Claude Code** (`claude`) and **Antigravity** (`agy`). Both are first-class; support is not.

Keep this file honest by editing it in the same commit as the change it describes.
`tests/harness-support.test.js` fails the build if a hook exists in `HOOK_REGISTRY` that this file
does not account for, and if a `gap` cell has no linked issue.

## The one root cause

**Antigravity has no hook layer.** `tools/deploy-hooks.js` copies hooks to `~/.claude/hooks` and
registers them under `hooks` in `~/.claude/settings.json`. Nothing equivalent exists for `agy`, so
every registered hook in `HOOK_REGISTRY` is Claude-only.

That single fact explains most of the `gap` cells below, which is why they share one tracking issue
rather than one each. Everything AgentSystem does *automatically* — inject memory, enforce routines,
route agents, log session cost, name sessions — rides on a hook. In an Antigravity session, those
features are not degraded; they never run. The tools they call still work when a human or a script
invokes them directly, which is the difference between the `gap` rows and an outright
`unsupported-by-design`.

Prior art for exactly this shape: hooks were once registered PowerShell-only, so on Linux the whole
pipeline was installed-but-inert (`CLAUDE.md` → Hooks). Same failure, different axis.

## Matrix

| Feature | Claude Code | Antigravity | Reason |
|---|---|---|---|
| Agent roster + definitions | `supported` | `supported` | `tools/sync-agents.js` writes both `~/.claude/agents/` and an `agy` plugin, then runs `agy plugin install`. |
| Agent routing (automatic) | `supported` | `supported` | Supported via `hooks/antigravity-bridge.js` executing `hooks/memory-router.js` and `hooks/routing-config.js` on `PreInvocation`. |
| Hooks | `supported` | `supported` | Supported natively via the `agy` plugin `hooks.json` manifest. |
| Routines engine — compile/verify | `supported` | `supported` | `tools/routines.js` is a plain Node CLI. Host-neutral. |
| Routines engine — enforcement | `supported` | `supported` | Supported via `hooks/antigravity-bridge.js` executing `routines-context-inject.js` on `PreInvocation`. |
| Memory / brain — read + write | `supported` | `supported` | `brain-remember.js`, `graph-query.js`, `brain-sync.js` are Node CLIs over `~/agent-memory/nexus/`. `GEMINI.md` documents the same paths. |
| Memory — auto-injection | `supported` | `supported` | Supported via `hooks/antigravity-bridge.js` executing `hooks/memory-context-inject.js` and `hooks/memory-context-inject-subagent.js` on `PreInvocation`. |
| Pre-compaction handoff doc | `supported` | `supported` | Supported via `hooks/antigravity-bridge.js` executing `context-handoff.sh` on `Stop`. |
| Memory — auto-capture | `supported` | `supported` | Supported via `hooks/antigravity-bridge.js` executing `memory-capture-hook.js` and `sona-writeback-hook.js` on `Stop`. |
| Session naming — the namer | `supported` | `supported` | `tools/session-namer.js` reads `agy` transcripts directly from `~/.gemini/antigravity-cli/`. |
| Session naming — automatic | `supported` | `supported` | Supported via `hooks/antigravity-bridge.js` executing `session-auto-rename-hook.js` on `Stop`. |
| Skills | `supported` | `unsupported-by-design` | `tools/deploy-private-skills.sh` installs to `~/.claude/skills/`; skills are a Claude Code construct with no `agy` equivalent. Life OS stage 2 therefore pins Claude. |
| Memory — usefulness scoring | `supported` | `supported` | Supported via `hooks/antigravity-bridge.js` executing `injection-feedback-hook.js` on `Stop`. |
| Cost tracking | `supported` | `supported` | Supported via `hooks/antigravity-bridge.js` executing `session-end.sh` on `Stop`. |
| Session registry bookkeeping | `supported` | `supported` | Supported via `hooks/antigravity-bridge.js` executing `session-start.sh`, `user-prompt-submit.sh`, and `session-close.sh` during lifecycle. |
| Session status lifecycle | `supported` | `supported` | Supported via `hooks/antigravity-bridge.js` executing `pr-status-detect.sh` on `PostToolUse`. |
| Routine dispatch + compliance | `supported` | `supported` | Supported via `hooks/antigravity-bridge.js` executing `routine-dispatch.js` and `routine-compliance-hook.js`. |
| Git safety guard | `supported` | `supported` | Supported via `hooks/antigravity-bridge.js` executing `guard-git.sh` on `PreToolUse` and denying on the child's **exit 2**. It was `supported` here and inert in practice until #514: the bridge threw away every non-zero exit status and sniffed stdout for `BLOCKED:`, which `guard-git.sh` writes to stderr. Asserted end to end by `hooks/antigravity-bridge.test.js`. |
| WIP checkpointing | `supported` | `supported` | Supported via `hooks/antigravity-bridge.js` executing `wip-checkpoint.sh` on `PostToolUse`. |
| Continuous sync — memory, session-triggered | `supported` | `supported` | Supported via `hooks/antigravity-bridge.js` executing `hooks/continuous-sync-hook.js` on start/stop. |
| Continuous sync — code checkout fast-forward | `supported` | `supported` | Supported via `hooks/antigravity-bridge.js` running checkout fast-forward on `PreInvocation` (start phase). |
| Continuous sync — hook redeploy after a pull | `supported` | `supported` | Supported via `hooks/antigravity-bridge.js` running hook redeploy on `PreInvocation` (start phase). |
| Continuous sync — host timer | `supported` | `supported` | `tools/install-brain-sync-timer.sh` (systemd `--user`) and `.ps1` (`schtasks`) run `tools/brain-sync-run.js` every ~15 min outside both harnesses on purpose. |
| Mission Control — dispatch | `supported` | `supported` | `webhook-server.js` takes `harness: "claude"｜"agy"` and enforces a per-harness concurrency cap. `agy-dispatcher.js` / `agy-persistence.js` handle the `agy` side. |
| Mission Control — session persistence | `supported` | `supported`, degradable | `agy` sessions need tmux; without it they run detached and cannot be attached to or reattached. Reported as `agy_persistence` on `/health` since #201. |
| human-needed alerts | `supported` | `supported` | `tools/human-needed.js` is a Node CLI over `gh`. Host-neutral. |
| Actions watchdog | `supported` | `supported` | `tools/actions-watchdog.js` runs on a systemd timer, outside both harnesses on purpose. |

## Caveats that are not gaps

**Agent `tools:` frontmatter is dropped for Antigravity.** `agy` silently discards any agent whose
`tools:` names a tool it does not recognise, and the roster's tool names are Claude-style. So
`sync-agents.js` omits the key entirely and `agy` agents load with default tool access. The agent
exists and works; its tool restrictions do not travel. Deliberate — see the comment at
`tools/sync-agents.js:157`.

**A crashing PreToolUse hook fails OPEN on `agy`, deliberately.** The bridge treats exit 2 as the
only deny — that is the whole of the Claude Code hook protocol's deny signal — and lets every other
non-zero status through with a debug-log line. A guard that dies for an environmental reason (`jq`
absent, no `bash` on `PATH`, the 15s timeout) would otherwise block every tool call for the rest of
the session, which is a worse outcome than one unguarded command. Do not "harden" this into
fail-closed without a way for the user to see and clear the condition; see #514 for why the status
and not the output text is the predicate.

**Model IDs differ.** `agy` is a Gemini-family runtime, so the sync maps each agent to
`MODELS.gemini`. Same roster, different model per host.

## Verifying a cell

Before flipping a cell to `supported`, run the feature on that host and check the effect, not the
exit code. The failure mode this document exists to prevent is a step that succeeds while doing
nothing: `deploy-hooks.js` exited 0 on Linux for months while registering nothing (`CLAUDE.md` →
Hooks), and four `enforce: hard` cron routines sat unregistered while `compile` printed Windows
instructions (#200). Exit 0 is not evidence.
