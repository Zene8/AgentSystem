/**
 * tests/test_routine_dispatch.js
 * node --test tests/test_routine_dispatch.js
 *
 * Regression coverage for #154: hooks/routine-dispatch.js already parsed PostToolUse Bash
 * payloads (tool_input.command / tool_response) to detect `gh pr create` and schedule the
 * auto-resolve-pr-comments routine, but the settings hook registration (sync_hooks_from_repo.ps1)
 * only wired routine-dispatch.js to the `Write|Edit|NotebookEdit` PostToolUse matcher — it was
 * never invoked with Bash tool events at all, so the routine never fired in practice. This suite
 * locks in that the dispatcher's own Bash-handling logic behaves correctly (the settings-side
 * wiring fix is verified separately by asserting the matcher registration exists in the script).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOOK = join(__dirname, '..', 'hooks', 'routine-dispatch.js');
const SYNC_SCRIPT = join(__dirname, '..', 'sync_hooks_from_repo.ps1');

function runHook(payload) {
  return execFileSync('node', [HOOK], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
  });
}

describe('routine-dispatch.js PostToolUse Bash handling', () => {
  it('detects `gh pr create` in a Bash tool_input and schedules auto-resolve when a PR URL is present', () => {
    const out = runHook({
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'gh pr create --title "x" --body "y"' },
      tool_response: 'https://github.com/Zene8/AgentSystem/pull/999',
    });
    assert.match(out, /auto-resolve-pr-comments/);
    assert.match(out, /#999/);
  });

  it('does nothing for a Bash command that is not `gh pr create`', () => {
    const out = runHook({
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'git status' },
      tool_response: '',
    });
    assert.equal(out.trim(), '');
  });

  it('does nothing when `gh pr create` runs but no PR URL is found in the response', () => {
    const out = runHook({
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'gh pr create --title "x" --body "y"' },
      tool_response: 'error: could not create pull request',
    });
    assert.equal(out.trim(), '');
  });

  it('ignores non-Bash PostToolUse tool names even if the input mentions gh pr create', () => {
    const out = runHook({
      hook_event_name: 'PostToolUse',
      tool_name: 'Write',
      tool_input: { command: 'gh pr create' },
      tool_response: 'https://github.com/Zene8/AgentSystem/pull/999',
    });
    assert.equal(out.trim(), '');
  });

  it('handles malformed/empty stdin without throwing', () => {
    const out = runHook(undefined) ?? '';
    assert.equal(typeof out, 'string');
  });
});

describe('sync_hooks_from_repo.ps1 registers routine-dispatch.js on the Bash PostToolUse matcher (#154)', () => {
  it('has a PostToolUse hook entry for routine-dispatch.js with matcher = Bash', () => {
    const script = readFileSync(SYNC_SCRIPT, 'utf8');
    // Find each PostToolUse block that runs routine-dispatch.js and collect its matcher.
    const blocks = script.split(/(?=\[PSCustomObject\]@\{)/).filter(b =>
      /event\s*=\s*'PostToolUse'/.test(b) && /routine-dispatch\.js/.test(b)
    );
    assert.ok(blocks.length >= 2, 'expected routine-dispatch.js registered on at least 2 PostToolUse matchers (Write|Edit|NotebookEdit and Bash)');
    const matchers = blocks.map(b => (b.match(/matcher\s*=\s*'([^']+)'/) || [])[1]);
    assert.ok(matchers.includes('Bash'), `expected a Bash matcher among ${JSON.stringify(matchers)}`);
  });
});
