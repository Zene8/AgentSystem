// brain-sync.test.js — exercises tools/brain-sync.js against real git repos, no network.
//
// Worth testing rather than eyeballing: this tool commits and pushes to a git history shared by
// every host running AgentSystem. The branch that matters most is the conflict classifier — a
// conflict in the generated graph.json is auto-resolved, a conflict in an authored node must stop
// for a human. Get that backwards and the tool silently discards someone's facts.
//
// Two working checkouts share one bare origin, standing in for the laptop and the server.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  classifyCorruption, CORRUPT_MARK, REMOTE_CORRUPT_MARK,
  PER_HOST_LOG_DENYLIST, denyExcludePathspecs, isPerHostLog, porcelainPath,
} from '../tools/brain-sync.js';

const TOOL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'brain-sync.js');
const IDENT = ['-c', 'user.name=t', '-c', 'user.email=t@t'];

function git(cwd, args) {
  const r = spawnSync('git', ['-C', cwd, ...IDENT, ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr || r.stdout}`);
  return (r.stdout || '').trim();
}

function sync(cwd, extra = []) {
  const r = spawnSync(process.execPath, [TOOL, '--path', cwd, ...extra], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

// One origin, two clones. Returns absolute paths.
function makeWorld() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'brainsync-'));
  const origin = path.join(base, 'origin.git');
  spawnSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);

  const seed = path.join(base, 'seed');
  fs.mkdirSync(path.join(seed, 'nexus', 'personal-brain', 'nodes'), { recursive: true });
  fs.writeFileSync(path.join(seed, 'nexus', 'personal-brain', 'nodes', 'shared.md'), 'seed\n');
  fs.writeFileSync(path.join(seed, 'nexus', 'personal-brain', 'graph.json'), '{"nodes":[]}\n');
  git(seed, ['init', '-q', '-b', 'main']);
  git(seed, ['remote', 'add', 'origin', origin]);
  git(seed, ['add', '-A']);
  git(seed, ['commit', '-q', '-m', 'seed']);
  git(seed, ['push', '-q', 'origin', 'main']);

  const hosts = ['hostA', 'hostB'].map((n) => {
    const p = path.join(base, n);
    spawnSync('git', ['clone', '-q', origin, p]);
    return p;
  });
  return { base, origin, hosts };
}

test('--status reports without changing anything', () => {
  const { base, hosts: [a] } = makeWorld();
  try {
    fs.writeFileSync(path.join(a, 'nexus', 'personal-brain', 'nodes', 'new.md'), 'x\n');
    const before = git(a, ['rev-parse', 'HEAD']);
    const r = sync(a, ['--status']);
    assert.equal(r.code, 0);
    assert.match(r.out, /uncommitted change/);
    assert.equal(git(a, ['rev-parse', 'HEAD']), before, '--status must not commit');
    assert.notEqual(git(a, ['status', '--porcelain']), '', '--status must not stage');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('local changes are committed and pushed', () => {
  const { base, hosts: [a, b] } = makeWorld();
  try {
    fs.writeFileSync(path.join(a, 'nexus', 'personal-brain', 'nodes', 'from-a.md'), 'a\n');
    const r = sync(a);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /pushed 1 commit/);

    // The other host must actually see it — the point of the whole exercise.
    git(b, ['pull', '-q', '--no-rebase', 'origin', 'main']);
    assert.ok(fs.existsSync(path.join(b, 'nexus', 'personal-brain', 'nodes', 'from-a.md')));
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('a clean checkout with nothing outgoing is a no-op', () => {
  const { base, hosts: [a] } = makeWorld();
  try {
    const r = sync(a);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /up to date/);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('conflict in generated graph.json is auto-resolved, keeping the local side', () => {
  const { base, hosts: [a, b] } = makeWorld();
  const rel = path.join('nexus', 'personal-brain', 'graph.json');
  try {
    // B publishes its version first, so A's pull collides.
    fs.writeFileSync(path.join(b, rel), '{"nodes":["from-b"]}\n');
    assert.equal(sync(b).code, 0);

    fs.writeFileSync(path.join(a, rel), '{"nodes":["from-a"]}\n');
    const r = sync(a);
    assert.equal(r.code, 0, `expected auto-resolve, got: ${r.err}`);
    assert.match(r.out, /resolved 1 generated graph\.json conflict/);
    assert.match(fs.readFileSync(path.join(a, rel), 'utf8'), /from-a/,
      'local side must win: graph.json is regenerated from nodes/ anyway');
    assert.equal(git(a, ['status', '--porcelain']), '', 'merge must be committed, not left mid-merge');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('conflict in an authored node stops for a human and leaves the merge in place', () => {
  const { base, hosts: [a, b] } = makeWorld();
  const rel = path.join('nexus', 'personal-brain', 'nodes', 'shared.md');
  try {
    fs.writeFileSync(path.join(b, rel), 'B learned something\n');
    assert.equal(sync(b).code, 0);

    fs.writeFileSync(path.join(a, rel), 'A learned something else\n');
    const r = sync(a);
    assert.equal(r.code, 1, 'a real content conflict must not be auto-resolved');
    assert.match(r.err, /needs a human/);
    assert.match(r.err, /shared\.md/);
    assert.notEqual(git(a, ['status', '--porcelain']), '',
      'conflict must be left in the worktree for the human to resolve');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

// ── the unfinished-merge guard (#348) ────────────────────────────────────────
//
// The regression that produced 221f626 in the brain repo: the stop above leaves MERGE_HEAD and
// marker-laden files behind, and the NEXT run used to read them as ordinary local changes and
// `commit` them — which concludes the merge, publishing `<<<<<<<` markers as content to every
// host. 129 brain files were corrupted that way and the weekly decay pass died on the JSON.

/** Drive host A into the half-merged state an interrupted sync leaves behind. */
function stall(world) {
  const [a, b] = world.hosts;
  const rel = path.join('nexus', 'personal-brain', 'nodes', 'shared.md');
  fs.writeFileSync(path.join(b, rel), 'B learned something\n');
  assert.equal(sync(b).code, 0);
  fs.writeFileSync(path.join(a, rel), 'A learned something else\n');
  assert.equal(sync(a).code, 1, 'first run must stop for a human');
  return { a, b, rel, head: git(a, ['rev-parse', 'HEAD']) };
}

test('a second run over an unresolved merge refuses rather than committing the markers', () => {
  const world = makeWorld();
  try {
    const { a, rel, head } = stall(world);

    const r = sync(a);
    assert.equal(r.code, 1, 'second run must refuse too');
    assert.match(r.err, /merge is still in progress/);
    assert.equal(git(a, ['rev-parse', 'HEAD']), head,
      'the unresolved merge must not have been committed');
    assert.doesNotMatch(git(a, ['show', `HEAD:${rel.split(path.sep).join('/')}`]), /<{7}/,
      'conflict markers must never reach a commit');
  } finally { fs.rmSync(world.base, { recursive: true, force: true }); }
});

// brain-sync-run.js decides whether to wake a human by matching this phrase on stderr; a bare exit
// 1 is filed as "some git command failed" and alerts nobody. A stuck tree that stays silent is the
// #348 failure mode with an extra step, so the wording is load-bearing, not cosmetic.
test('the refusal is worded so the wrapper raises a human-needed alert', () => {
  const world = makeWorld();
  try {
    const { a } = stall(world);
    assert.match(sync(a).err, /merge conflict needs a human/);
  } finally { fs.rmSync(world.base, { recursive: true, force: true }); }
});

// --pull-only writes nothing, so it never reaches `add -A` — but it does pull, and pulling onto a
// half-merged tree is a confusing git error rather than an answer. It runs at every SessionStart,
// which is the run most likely to meet a tree someone abandoned yesterday.
test('--pull-only refuses over an unresolved merge instead of pulling onto it', () => {
  const world = makeWorld();
  try {
    const { a, head } = stall(world);
    const r = sync(a, ['--pull-only']);
    assert.equal(r.code, 1);
    assert.match(r.err, /merge is still in progress/);
    assert.equal(git(a, ['rev-parse', 'HEAD']), head);
  } finally { fs.rmSync(world.base, { recursive: true, force: true }); }
});

// --ignore-markers is #341's escape hatch for a node that legitimately quotes marker text. It
// suppresses a text scan and nothing else: an actually-unfinished merge is git state, and letting a
// flag past it would re-open #348 behind an override.
test('--ignore-markers does not unblock an unresolved merge', () => {
  const world = makeWorld();
  try {
    const { a, head } = stall(world);
    const r = sync(a, ['--ignore-markers']);
    assert.equal(r.code, 1, '--ignore-markers concluded a real merge');
    assert.match(r.err, /merge is still in progress/);
    assert.equal(git(a, ['rev-parse', 'HEAD']), head);
  } finally { fs.rmSync(world.base, { recursive: true, force: true }); }
});

// The other half of #340: an earlier run already committed the markers, so there is no MERGE_HEAD
// and no unmerged path — git considers the tree clean. Syncing on top of that pushes the corruption
// to every host, so the scan is over tracked content, not the index.
test('markers already committed block the sync, and --ignore-markers is the way past', () => {
  const { base, hosts: [a] } = makeWorld();
  const rel = path.join('nexus', 'personal-brain', 'nodes', 'shared.md');
  try {
    fs.writeFileSync(path.join(a, rel), '<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> origin/main\n');
    git(a, ['add', '-A']);
    git(a, ['commit', '-q', '-m', 'markers committed by an earlier bad sync']);
    assert.equal(git(a, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']).length, 40);

    const blocked = sync(a);
    assert.equal(blocked.code, 1, 'committed markers were synced onward');
    assert.match(blocked.err, /still contain merge-conflict markers/);
    assert.match(blocked.err, /shared\.md/);
    assert.match(blocked.err, /--ignore-markers/, 'the refusal must name its own escape hatch');

    const forced = sync(a, ['--ignore-markers']);
    assert.equal(forced.code, 0, forced.err);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

// This used to assert that --pull-only committed locally and held the commit back from the remote.
// #341 made it stricter: --pull-only now runs at every SessionStart on every host, so committing is
// not a smaller version of pushing — it is turning whatever is open in an editor into a permanent
// commit that the next full sync pushes everywhere. --pull-only writes nothing.
test('--pull-only merges without committing or pushing', () => {
  const { base, hosts: [a, b] } = makeWorld();
  try {
    fs.writeFileSync(path.join(b, 'nexus', 'personal-brain', 'nodes', 'from-b.md'), 'b\n');
    assert.equal(sync(b).code, 0);

    fs.writeFileSync(path.join(a, 'nexus', 'personal-brain', 'nodes', 'from-a.md'), 'a\n');
    const r = sync(a, ['--pull-only']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /not pushing/);
    assert.ok(fs.existsSync(path.join(a, 'nexus', 'personal-brain', 'nodes', 'from-b.md')),
      'pull must still have happened');
    assert.equal(git(a, ['rev-list', '--count', 'origin/main..HEAD']), '0',
      '--pull-only committed local work');
    assert.match(git(a, ['status', '--porcelain']), /from-a\.md/,
      'the local edit was swallowed instead of being left for the author');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('a directory that is not a git checkout exits 2 with the clone hint', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brainsync-nogit-'));
  try {
    const r = sync(dir);
    assert.equal(r.code, 2);
    assert.match(r.err, /no git checkout/);
    assert.match(r.err, /clone it first/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('an unknown flag exits 2 rather than guessing', () => {
  const r = spawnSync(process.execPath, [TOOL, '--wat'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unknown option/);
});

// ── the corrupt-object-database guard ────────────────────────────────────────
//
// A damaged object database (a zeroed-out loose object) makes plain git commands fail with git's
// own distinctive error text -- "object file ... is empty", "fatal: bad object" -- and until now
// brain-sync.js reported that identically to an offline fetch or a stale token: exit 1, a generic
// message. brain-sync-run.js's classify() then filed it as a non-alerting error. Real-world blast
// radius: #429/#430 -- weekly-memory-decay and weekly-trust-scores both died in 9s on this exact
// `fatal: bad object HEAD`, and nothing in the chain said the brain repo was corrupt.

/** Corrupt a real git object the way production actually broke: truncate a loose object to empty. */
function corruptHead(repo) {
  const head = spawnSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  const objPath = path.join(repo, '.git', 'objects', head.slice(0, 2), head.slice(2));
  fs.chmodSync(objPath, 0o644); // git writes loose objects read-only
  fs.writeFileSync(objPath, '');
  return objPath;
}

test('a corrupt object database is reported distinctly, not as a generic failure or a conflict', () => {
  const { base, hosts: [a] } = makeWorld();
  try {
    corruptHead(a);
    const r = sync(a);
    assert.equal(r.code, 1, 'a damaged object database must not be reported as healthy');
    assert.match(r.err, /agent-memory git object database is corrupt/);
    assert.doesNotMatch(r.err, /merge conflict needs a human/,
      'corruption must not be conflated with the #348 merge-conflict guard');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('--ignore-markers does not bypass the corruption guard', () => {
  const { base, hosts: [a] } = makeWorld();
  try {
    corruptHead(a);
    const r = sync(a, ['--ignore-markers']);
    assert.equal(r.code, 1, 'there is no operator override for a damaged object database');
    assert.match(r.err, /agent-memory git object database is corrupt/);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

// The regression that the first version of this guard shipped with. The guard only ran on the
// `!allowFail` path, and the one call that reads the most of the object database — the merge inside
// `git pull` — is `allowFail: true`, because a merge conflict is an expected outcome there.
//
// So damage that `git status` never touches (a bad object behind the merge base) produced: a
// non-zero pull, an EMPTY unmerged-paths list, and a fall through to the conflict branch, which
// printed `merge conflict needs a human` followed by `(see git status)`. brain-sync-run.js then
// raised the conflict alert, telling a person to resolve a merge that does not exist while the real
// fault — a corrupt object database — went unnamed. Verified against the pre-fix file: it prints
// exactly that.
test('object damage that only the merge touches is CORRUPT, not a phantom merge conflict', () => {
  const { base, origin, hosts: [a, b] } = makeWorld();
  try {
    const node = path.join('nexus', 'personal-brain', 'nodes', 'shared.md');
    // Both hosts edit the same node, so the pull must do a real three-way content merge and read the
    // *base* blob. Different lines, so absent the corruption this merges cleanly — the test must
    // fail on the corruption, not on a conflict it engineered.
    fs.writeFileSync(path.join(b, node), 'seed\nfrom-b\n');
    git(b, ['add', '-A']);
    git(b, ['commit', '-q', '-m', 'b']);
    git(b, ['push', '-q', 'origin', 'HEAD']);

    fs.writeFileSync(path.join(a, node), 'from-a\nseed\n');
    // Corrupt the merge BASE blob only. HEAD, the index and the working tree are all intact, so
    // `git status` (which compares stat data and re-hashes the working file) is perfectly happy and
    // the fetch, which moves commits and trees, never reads it either.
    const blob = git(a, ['rev-parse', `HEAD:${node.split(path.sep).join('/')}`]);
    const objPath = path.join(a, '.git', 'objects', blob.slice(0, 2), blob.slice(2));
    fs.chmodSync(objPath, 0o644);
    fs.writeFileSync(objPath, '');
    assert.equal(
      spawnSync('git', ['-C', a, 'status', '--porcelain'], { encoding: 'utf8' }).status, 0,
      'precondition: this damage must be invisible to git status, or the test proves nothing');

    const r = sync(a);
    assert.equal(r.code, 1);
    assert.match(r.err, /agent-memory git object database is corrupt/);
    assert.doesNotMatch(r.err, /merge conflict needs a human/,
      'a corrupt object database was reported as a merge conflict — the alert would tell a human '
      + 'to resolve a merge that does not exist');
    assert.doesNotMatch(r.err, /\(see git status\)/,
      'the empty-conflict-list fallback fired, which is the pre-fix symptom');
    assert.ok(origin);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

// ── local damage vs. the remote's damage ─────────────────────────────────────
//
// Not reproducible against a file:// origin (git only prefixes `remote: ` over a real transport, and
// a local clone hardlinks its objects), so it is asserted on the classifier with stderr shaped the
// way ssh/https actually relay it.

test('corruption reported by origin is diagnosed as REMOTE, never as local damage', () => {
  const relayed = [
    'remote: error: object file ./objects/a0/659570b3c5 is empty',
    'remote: fatal: unable to read blob object a0659570b3c5',
    'fatal: protocol error: bad pack header',
  ].join('\n');
  const c = classifyCorruption(relayed);
  assert.equal(c?.side, 'remote',
    'a corrupt ORIGIN read as local damage sends the operator to delete their own healthy checkout');

  assert.equal(classifyCorruption('error: object file .git/objects/a0/659570 is empty')?.side, 'local');
  // Local wins when both sides are shouting: the damage in front of the operator is the one to fix.
  assert.equal(classifyCorruption(`${relayed}\nfatal: bad object HEAD`)?.side, 'local');
  assert.equal(classifyCorruption('fatal: unable to access https://…: Could not resolve host'), null,
    'an offline fetch is not corruption');
  assert.equal(classifyCorruption(''), null);
});

test('the two sentinel phrases are disjoint, and neither is the conflict phrase', () => {
  // brain-sync-run.js classifies with String.includes, so a phrase containing the other would make
  // a remote fault match the local branch and hand back re-clone instructions.
  assert.ok(!REMOTE_CORRUPT_MARK.includes(CORRUPT_MARK));
  assert.ok(!CORRUPT_MARK.includes(REMOTE_CORRUPT_MARK));
  for (const m of [CORRUPT_MARK, REMOTE_CORRUPT_MARK]) {
    assert.ok(!m.includes('merge conflict needs a human'));
  }
});

// --- Per-host append-only logs must never enter the shared history (#482) -------------------
//
// The weekly decay job died pushing `nexus/personal-brain/visits.log`. That file is written by
// nearly every graph query on every host, it holds no durable fact, and it is absent from the brain
// repo's .gitignore -- a repo this one cannot edit. So the first host to sync tracked it, and from
// then on every host's own appends conflicted with every other host's, on every sync, forever. The
// exclusion has to live here, in the tool, because that is the only side of the problem this repo
// owns.

test('an untracked per-host log is excluded from staging while real changes still sync', () => {
  const { base, hosts: [a] } = makeWorld();
  try {
    fs.writeFileSync(path.join(a, 'nexus', 'personal-brain', 'visits.log'), 'a\tb\t1\n');
    fs.writeFileSync(path.join(a, 'nexus', 'personal-brain', 'nodes', 'fact.md'), 'durable\n');

    const r = sync(a);
    assert.equal(r.code, 0, r.err);

    const tracked = git(a, ['ls-files']).split('\n');
    assert.ok(tracked.includes('nexus/personal-brain/nodes/fact.md'),
      'the authored node is the whole point of the sync and must be committed');
    assert.ok(!tracked.some((f) => f.endsWith('visits.log')),
      'visits.log entered the shared history -- #482 recurs on the next host that syncs');
    // Still on disk: this is a live per-host log, not garbage to delete.
    assert.ok(fs.existsSync(path.join(a, 'nexus', 'personal-brain', 'visits.log')));
    assert.match(r.out, /per-host append-only log\(s\) excluded from staging/);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('every denylisted name is excluded, at any depth, and nothing else is', () => {
  const { base, hosts: [a] } = makeWorld();
  try {
    for (const name of PER_HOST_LOG_DENYLIST) {
      fs.writeFileSync(path.join(a, 'nexus', 'personal-brain', name), 'x\n');
    }
    // Depth matters: the pathspecs are `*name`, and git's default wildmatch lets `*` cross `/`.
    fs.mkdirSync(path.join(a, 'nexus', 'agent-brain', 'leo'), { recursive: true });
    fs.writeFileSync(path.join(a, 'nexus', 'agent-brain', 'leo', 'visits.log'), 'x\n');
    // Deliberately NOT denylisted: the event ledgers are tracked on purpose, per the brain's own
    // .gitignore comment. A denylist that swallowed these would silently stop syncing real state.
    fs.mkdirSync(path.join(a, 'nexus', 'events'), { recursive: true });
    fs.writeFileSync(path.join(a, 'nexus', 'events', 'done.jsonl'), '{}\n');

    assert.equal(sync(a).code, 0);
    const tracked = git(a, ['ls-files']).split('\n');
    for (const name of PER_HOST_LOG_DENYLIST) {
      assert.ok(!tracked.some((f) => f.endsWith(`/${name}`) || f === name), `${name} was tracked`);
    }
    assert.ok(tracked.includes('nexus/events/done.jsonl'),
      'the event ledger is shared state and must keep syncing');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('a sync whose only changes are per-host logs commits nothing and still exits 0', () => {
  // `git status --porcelain` collapses an untracked directory to a single entry, so a directory
  // holding nothing but denylisted logs reads as a real change and then stages nothing. Committing
  // an empty index exits 1, which brain-sync-run.js classifies as `error` -> exit 2 -> a red weekly
  // run and no alert, over a file we chose to skip.
  const { base, hosts: [a] } = makeWorld();
  try {
    fs.mkdirSync(path.join(a, 'nexus', 'fresh-brain'), { recursive: true });
    fs.writeFileSync(path.join(a, 'nexus', 'fresh-brain', 'visits.log'), 'x\n');

    const before = git(a, ['rev-parse', 'HEAD']);
    const r = sync(a);
    assert.equal(r.code, 0, `${r.out}\n${r.err}`);
    assert.equal(git(a, ['rev-parse', 'HEAD']), before, 'an empty commit was created');
    assert.match(r.out, /nothing committed/);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('an ALREADY-TRACKED per-host log keeps syncing, and is reported loudly, not fixed', () => {
  // Two halves, both load-bearing.
  //
  // Reported, not fixed: untracking is an index write against a private user-data repo. A tool that
  // does that unasked, from a cron job, is a change nobody approved.
  //
  // Keeps syncing: refusing to stage a tracked file whose content changed leaves the tree
  // permanently dirty, and the next pull then refuses to merge at all -- turning a conflict on one
  // worthless log into a total sync outage. Strictly worse than the bug.
  const { base, hosts: [a] } = makeWorld();
  try {
    const p = path.join(a, 'nexus', 'personal-brain', 'visits.log');
    fs.writeFileSync(p, 'first\n');
    git(a, ['add', '-f', 'nexus/personal-brain/visits.log']);
    git(a, ['commit', '-q', '-m', 'the mistake this test describes']);

    fs.appendFileSync(p, 'second\n');
    const r = sync(a);
    assert.equal(r.code, 0, r.err);

    assert.match(r.err, /WARNING/);
    assert.match(r.err, /nexus\/personal-brain\/visits\.log/);
    assert.match(r.err, /rm --cached/,
      'the operator must be handed the exact command; a warning with no remedy is noise');
    assert.match(r.err, /#482/);

    assert.equal(git(a, ['status', '--porcelain']), '',
      'a tracked denylisted log left dirty makes the next pull refuse the merge');
    const status = sync(a, ['--status']);
    assert.match(status.out, /tracked {3}1 per-host log\(s\) TRACKED/);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('pathspec and basename helpers agree, and the exclusions are real git syntax', () => {
  assert.deepEqual(denyExcludePathspecs(['visits.log']), [':(exclude)*visits.log']);
  assert.ok(isPerHostLog('nexus/personal-brain/visits.log'));
  assert.ok(isPerHostLog('nexus\\personal-brain\\visits.log'));
  assert.ok(!isPerHostLog('nexus/personal-brain/nodes/visits.log.md'));
  assert.ok(!isPerHostLog('nexus/events/done.jsonl'));
  // Rename lines are `R  old -> new`; classifying on the OLD path would stage the new one.
  assert.equal(porcelainPath('R  a.md -> nexus/b/visits.log'), 'nexus/b/visits.log');
  assert.equal(porcelainPath('?? nexus/personal-brain/visits.log'), 'nexus/personal-brain/visits.log');
  // The caller trims the whole `git status --porcelain` output, so an unstaged-only first line
  // arrives WITHOUT its leading space. A fixed slice(3) shifted the path by one character, the
  // tracked-set lookup then missed, and a tracked dirty log was left unstaged -- a permanently
  // dirty tree, i.e. the next pull refuses to merge at all.
  assert.equal(porcelainPath('M nexus/personal-brain/visits.log'), 'nexus/personal-brain/visits.log');
  assert.equal(porcelainPath(' M nexus/personal-brain/visits.log'), 'nexus/personal-brain/visits.log');
  assert.equal(porcelainPath('MM nexus/a/visits.log'), 'nexus/a/visits.log');
});

// A tracked copy must not drag its untracked SIBLINGS into the history (#482, audit finding).
//
// `visits.log` is written once per brain, so the same basename lives at
// nexus/personal-brain/visits.log AND nexus/agent-brain/<agent>/visits.log. The first version of
// this fix carved the whole NAME out of the exclusion set as soon as any one copy was tracked —
// which means the hosts already suffering from #482 would have started committing every other
// brain's still-clean visits.log, seeding new permanent conflicts. The carve-out is path-exact.
test('a tracked per-host log does not un-exclude its untracked siblings', () => {
  const { base, hosts: [a] } = makeWorld();
  try {
    const tracked = path.join(a, 'nexus', 'personal-brain', 'visits.log');
    fs.writeFileSync(tracked, 'first\n');
    git(a, ['add', '-f', 'nexus/personal-brain/visits.log']);
    git(a, ['commit', '-q', '-m', 'the pre-existing mistake']);

    // Same basename, different brain, never tracked.
    fs.mkdirSync(path.join(a, 'nexus', 'agent-brain', 'leo'), { recursive: true });
    fs.writeFileSync(path.join(a, 'nexus', 'agent-brain', 'leo', 'visits.log'), 'x\n');
    fs.appendFileSync(tracked, 'second\n');
    fs.writeFileSync(path.join(a, 'nexus', 'personal-brain', 'nodes', 'fact.md'), 'durable\n');

    const r = sync(a);
    assert.equal(r.code, 0, r.err);

    const files = git(a, ['ls-files']).split('\n');
    assert.ok(files.includes('nexus/personal-brain/nodes/fact.md'), 'the authored node must sync');
    assert.ok(!files.includes('nexus/agent-brain/leo/visits.log'),
      'the untracked sibling was committed — #482 spreads to another path');
    // The already-tracked one still syncs, or the tree stays dirty and the next pull refuses.
    assert.ok(files.includes('nexus/personal-brain/visits.log'));
    // The tracked copy must end STAGED (an unstaged tracked change is the dirty tree that makes the
    // next pull refuse to merge). The sibling's directory legitimately stays untracked, and
    // `git status` collapses it to one `?? nexus/agent-brain/` entry -- that entry IS the fix
    // working, so asserting a totally clean tree here would assert the bug back in.
    const left = git(a, ['status', '--porcelain']).split(/\s*[\r\n]+\s*/).filter(Boolean);
    assert.deepEqual(left.filter((l) => !/^\?\?/.test(l)), [],
      'tracked-and-dirty must end staged; a dirty tracked file makes the next pull refuse the merge');
    assert.deepEqual(left, ['?? nexus/agent-brain/'],
      'the only thing left may be the deliberately-excluded sibling');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});
