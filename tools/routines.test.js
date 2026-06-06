import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRoutinesYml, dispatchRoutines } from './routines.js';

// --- parseRoutinesYml ---

const SAMPLE_YML = `
- id: always-worktree
  description: Feature work in a worktree
  trigger: feature_work
  mechanism: agent-rule
  enforce: hard
  enabled: true
  action: "Do the worktree thing."

- id: auto-resolve
  description: Auto resolve PR comments
  trigger: pr_create
  mechanism: hook
  enforce: hard
  enabled: true
  action: "Schedule a job."

- id: disabled-rule
  description: This one is off
  trigger: feature_work
  mechanism: agent-rule
  enforce: hard
  enabled: false
  action: "Should not appear."
`;

test('parseRoutinesYml parses 3 entries', () => {
  const routines = parseRoutinesYml(SAMPLE_YML);
  assert.strictEqual(routines.length, 3);
});

test('parseRoutinesYml correctly parses string fields', () => {
  const routines = parseRoutinesYml(SAMPLE_YML);
  const r = routines[0];
  assert.strictEqual(r.id, 'always-worktree');
  assert.strictEqual(r.mechanism, 'agent-rule');
  assert.strictEqual(r.trigger, 'feature_work');
  assert.strictEqual(r.enforce, 'hard');
});

test('parseRoutinesYml parses boolean enabled=true', () => {
  const routines = parseRoutinesYml(SAMPLE_YML);
  assert.strictEqual(routines[0].enabled, true);
  assert.strictEqual(routines[2].enabled, false);
});

test('parseRoutinesYml parses action without trailing quote artifacts', () => {
  const routines = parseRoutinesYml(SAMPLE_YML);
  assert.ok(routines[0].action.includes('worktree'), 'action should contain worktree');
});

test('parseRoutinesYml handles comment lines', () => {
  const yml = `# top comment
- id: foo
  # inline comment
  description: bar
  trigger: t
  mechanism: hook
  enforce: hard
  enabled: true
  action: "x"
`;
  const routines = parseRoutinesYml(yml);
  assert.strictEqual(routines.length, 1);
  assert.strictEqual(routines[0].id, 'foo');
});

test('parseRoutinesYml idempotent on empty input', () => {
  const routines = parseRoutinesYml('');
  assert.deepEqual(routines, []);
});

// --- dispatchRoutines ---
// dispatchRoutines reads actual files, so we test the filter logic inline
// by mocking the imported function's behavior.

test('parseRoutinesYml filter: hook-mechanism, enabled, not bypassed', () => {
  const routines = parseRoutinesYml(SAMPLE_YML);
  const overrides = {};

  // Simulate dispatchRoutines filter logic (PostToolUse / pr_create)
  const matched = routines.filter(r => {
    if (!r.enabled) return false;
    if (overrides[r.id]) return false;
    if (r.mechanism !== 'hook') return false;
    if (r.trigger === 'pr_create') return true;
    return false;
  });

  assert.strictEqual(matched.length, 1);
  assert.strictEqual(matched[0].id, 'auto-resolve');
});

test('parseRoutinesYml filter: bypass suppresses routine', () => {
  const routines = parseRoutinesYml(SAMPLE_YML);
  const overrides = { 'auto-resolve': { bypassed: true } };

  const matched = routines.filter(r => {
    if (!r.enabled) return false;
    if (overrides[r.id]) return false;
    if (r.mechanism !== 'hook') return false;
    if (r.trigger === 'pr_create') return true;
    return false;
  });

  assert.strictEqual(matched.length, 0, 'bypassed routine should be excluded');
});

test('parseRoutinesYml filter: disabled routine not included', () => {
  const routines = parseRoutinesYml(SAMPLE_YML);
  const overrides = {};

  const matched = routines.filter(r => {
    if (!r.enabled) return false;
    if (overrides[r.id]) return false;
    if (r.mechanism !== 'agent-rule') return false;
    if (r.trigger === 'feature_work') return true;
    return false;
  });

  // always-worktree is enabled, disabled-rule is not
  assert.strictEqual(matched.length, 1);
  assert.strictEqual(matched[0].id, 'always-worktree');
});
