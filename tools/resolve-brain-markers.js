#!/usr/bin/env node
// resolve-brain-markers.js — repair committed git conflict markers in the agent brain, losslessly.
//
// Usage:
//   node tools/resolve-brain-markers.js                 repair ~/agent-memory in place
//   node tools/resolve-brain-markers.js --check         report only; write nothing; exit 1 if dirty
//   node tools/resolve-brain-markers.js --root=<dir>    operate on a checkout other than ~/agent-memory
//   node tools/resolve-brain-markers.js --json          machine-readable report on stdout
//   node tools/resolve-brain-markers.js --quiet         suppress the per-file lines
//
// Exit codes: 0 clean (or fully repaired) · 1 markers found (--check), unresolvable, or an
//              unmerged path whose merge result cannot be proved lossless (#494) · 2 bad usage.
//
// ── Why this exists ──────────────────────────────────────────────────────────────────────────
//
// brain-sync.js runs `git add -A` BEFORE it pulls (#344). A half-merged working tree is just file
// content to `add -A`, so `<<<<<<<` / `=======` / `>>>>>>>` get committed and pushed as data. It
// hit 128 files in the brain repo. The one-off script that repaired them is promoted here so the
// repair is reviewable, tested, and runnable from the dispatchable maintenance workflow.
//
// That last clause used to end "— there is no SSH to the runner that holds the affected
// checkout", which is FALSE and was load-bearing (#439): ssh to baselyserver works, as
// basely@100.73.130.84 over the tailnet. The usernames tried and failed in #439 were natha@,
// nathan@, zene8@, ubuntu@ and nathanj@; the account is basely (/home/basely). `tailscale ssh`
// does still fail host-key verification, so use plain ssh to the tailnet IP. The workflow remains
// the right channel — it is auditable and needs no key on the calling host — but the reason is
// convenience, not impossibility, and several alerts were wrongly filed as console-only human
// tasks on the strength of the old wording.
//
// ── The two resolution rules (both lossless by construction) ─────────────────────────────────
//
// 1. DATE BLOCK. A block where every non-blank line on BOTH sides is a date-ish frontmatter key
//    (created | updated | last_visited | last_updated | date) keeps the EARLIER value per key.
//    `created:` is a creation timestamp: the earlier one is the true one, and a later value is a
//    re-import artifact. Taking the max would silently rewrite when a node came into existence.
//
// 2. UNION. Everything else emits both sides, HEAD first, de-duplicated line-wise. Union cannot
//    lose a fact; picking a side can. The cost is that a scalar frontmatter key that genuinely
//    differs on the two sides (`salience: 0.3` vs `salience: 0.5`) survives twice — a duplicate
//    key a human can see and fix. That trade is deliberate: a visible duplicate is recoverable,
//    a dropped decision-log entry is not.
//
// ── graph.json is NEVER repaired line-by-line ────────────────────────────────────────────────
//
// It is GENERATED, not authored: the graph tools rewrite it whole, so two hosts thinking at once
// conflict on it every time and a union of two JSON documents is not JSON. This tool takes ONE
// side (HEAD first, then the other), keeps it only if it parses AND looks like a graph, and
// leaves the real rebuild to `tools/graph/graph-init.js`, which repopulates from `nodes/`.
// Callers must rebuild after repairing — see runner-maintenance.yml. The correct invocation for
// a brain outside a repo is:
//
//   node tools/graph/graph-init.js <slug> --brain-path="$HOME/agent-memory/nexus/<slug>"
//
// NOT the positional `graph-init.js <slug> <path>` form, which writes a nested brain inside the
// brain and prints a success line for work it did not do (#346).
//
// ── One shell trap encoded here ──────────────────────────────────────────────────────────────
//
// The file search uses execFileSync with an ARGS ARRAY, never a shell string. `<<<<<<<` in a
// command string is parsed as redirection by cmd.exe on Windows (and would need heavy quoting in
// sh), so any "run this git grep command line" form is broken on one of the two platforms this
// repo runs on. An args array never reaches a shell at all — which is also why the string-taking
// exec variants are banned outright here, and asserted against in the test file.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, basename, relative, resolve as resolvePath, sep } from 'node:path';
import { homedir } from 'node:os';
import { isMainModule } from './is-main.js';
import { parseFlags } from './cli-args.js';

const USAGE =
  'Usage: node tools/resolve-brain-markers.js [--check] [--root=<dir>] [--json] [--quiet]';

// The literal token git writes at the head of a conflict. Kept as a constant so it is never
// interpolated into a shell string anywhere.
export const CONFLICT_TOKEN = '<<<<<<<';

const RE_START = /^<<<<<<<(?:\s|$)/;
const RE_BASE = /^\|{7}(?:\s|$)/; // diff3 style common-ancestor section
const RE_SEP = /^={7}\s*$/;
const RE_END = /^>{7}(?:\s|$)/;

// The frontmatter keys that carry a timestamp rather than a fact.
const DATE_KEY = /^(\s*)(created|updated|last_visited|last_updated|date)\s*:\s*(\S.*?)\s*$/;

const SKIP_DIRS = new Set(['.git', 'node_modules', '.cache']);
const MAX_FILE_BYTES = 32 * 1024 * 1024;

// ── Conflict parsing ─────────────────────────────────────────────────────────────────────────

/**
 * Split a document into plain-text runs and conflict blocks.
 *
 * A block is only recognised when it is COMPLETE (`<<<<<<<` … `=======` … `>>>>>>>`). A file that
 * merely mentions the token — documentation about merge conflicts, for instance — yields no
 * blocks and is left byte-for-byte alone. That matters: this tool runs unattended over a whole
 * brain and must not rewrite prose that only looks like a conflict.
 *
 * @param {string} text
 * @returns {{segments: Array<{type:'text',lines:string[]}|{type:'conflict',ours:string[],base:string[],theirs:string[]}>, eol: string, trailingNewline: boolean}}
 */
export function parseSegments(text) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const trailingNewline = /\r?\n$/.test(text);
  const lines = text.replace(/\r?\n$/, '').split(/\r?\n/);
  if (text === '') return { segments: [], eol, trailingNewline: false };

  /** @type {Array<any>} */
  const segments = [];
  let plain = [];
  const flush = () => {
    if (plain.length) segments.push({ type: 'text', lines: plain });
    plain = [];
  };

  for (let i = 0; i < lines.length; i++) {
    if (!RE_START.test(lines[i])) {
      plain.push(lines[i]);
      continue;
    }

    // Scan forward for a complete block. Nested starts are not a thing git produces; a second
    // `<<<<<<<` before the separator means the first one was not a real marker, so abandon it.
    const ours = [];
    const base = [];
    const theirs = [];
    let phase = 'ours';
    let end = -1;

    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j];
      if (RE_START.test(line)) break; // malformed — leave the region untouched
      if (phase !== 'theirs' && RE_BASE.test(line)) { phase = 'base'; continue; }
      if (phase !== 'theirs' && RE_SEP.test(line)) { phase = 'theirs'; continue; }
      if (RE_END.test(line)) { end = j; break; }
      (phase === 'ours' ? ours : phase === 'base' ? base : theirs).push(line);
    }

    if (end === -1 || phase !== 'theirs') {
      plain.push(lines[i]); // incomplete: treat the marker line as ordinary text
      continue;
    }

    flush();
    segments.push({ type: 'conflict', ours, base, theirs });
    i = end;
  }

  flush();
  return { segments, eol, trailingNewline };
}

const isBlank = (l) => l.trim() === '';

/**
 * True when EVERY non-blank line on both sides is a date-ish frontmatter key, and at least one
 * such line exists. An empty side satisfies this vacuously — a block that added a `created:` on
 * one side only is still a date block, and rule 1 then trivially keeps the single value.
 */
export function isDateBlock(ours, theirs) {
  const all = [...ours, ...theirs].filter((l) => !isBlank(l));
  if (all.length === 0) return false;
  return all.every((l) => DATE_KEY.test(l));
}

/** The earlier of two timestamp values, by real date when both parse, else lexicographically. */
export function earlierValue(a, b) {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isFinite(ta) && Number.isFinite(tb)) return ta <= tb ? a : b;
  return a <= b ? a : b;
}

/** Rule 1: one line per key, carrying the earlier value, in first-seen order (HEAD first). */
export function resolveDateBlock(ours, theirs) {
  /** @type {string[]} */
  const order = [];
  /** @type {Map<string,{line:string,value:string}>} */
  const best = new Map();

  for (const line of [...ours, ...theirs]) {
    const m = DATE_KEY.exec(line);
    if (!m) continue;
    const key = m[2];
    const value = m[3];
    const current = best.get(key);
    if (!current) {
      order.push(key);
      best.set(key, { line, value });
      continue;
    }
    if (value !== current.value && earlierValue(value, current.value) === value) {
      best.set(key, { line, value });
    }
  }

  return order.map((k) => best.get(k).line);
}

/** Rule 2: both sides, HEAD first, non-blank lines de-duplicated. */
export function unionBlock(ours, theirs) {
  const seen = new Set();
  const out = [];
  for (const line of [...ours, ...theirs]) {
    if (isBlank(line)) {
      out.push(line);
      continue;
    }
    if (seen.has(line)) continue;
    seen.add(line);
    out.push(line);
  }
  return out;
}

/**
 * Apply the two rules to every conflict in a document.
 * @returns {{text:string, blocks:number, dateBlocks:number, unionBlocks:number, changed:boolean}}
 */
export function resolveText(text) {
  const { segments, eol, trailingNewline } = parseSegments(text);
  let dateBlocks = 0;
  let unionBlocks = 0;
  const out = [];

  for (const seg of segments) {
    if (seg.type === 'text') {
      out.push(...seg.lines);
      continue;
    }
    if (isDateBlock(seg.ours, seg.theirs)) {
      dateBlocks++;
      out.push(...resolveDateBlock(seg.ours, seg.theirs));
    } else {
      unionBlocks++;
      out.push(...unionBlock(seg.ours, seg.theirs));
    }
  }

  const blocks = dateBlocks + unionBlocks;
  const rendered = out.join(eol) + (trailingNewline ? eol : '');
  return { text: rendered, blocks, dateBlocks, unionBlocks, changed: blocks > 0 };
}

/** Render a document keeping only one side of every conflict. */
export function renderSide(text, side) {
  const { segments, eol, trailingNewline } = parseSegments(text);
  const out = [];
  for (const seg of segments) {
    if (seg.type === 'text') out.push(...seg.lines);
    else out.push(...(side === 'ours' ? seg.ours : seg.theirs));
  }
  return out.join(eol) + (trailingNewline ? eol : '');
}

/**
 * graph.json strategy: take ONE side, never a merge of the two.
 *
 * HEAD first, then the incoming side. The result is kept only if it parses as JSON AND carries a
 * `nodes` array — a side that parses but is not a graph would be worse than no repair, because
 * graph-init.js would then happily build on top of it.
 *
 * @returns {{text:string, side:'ours'|'theirs'}|null} null when neither side yields a usable graph.
 */
export function resolveGeneratedJson(text) {
  for (const side of /** @type {const} */ (['ours', 'theirs'])) {
    const candidate = renderSide(text, side);
    try {
      const obj = JSON.parse(candidate);
      if (obj && typeof obj === 'object' && Array.isArray(obj.nodes)) return { text: candidate, side };
    } catch {
      /* try the other side */
    }
  }
  return null;
}

/** graph.json is generated; anything else is authored. */
export function isGeneratedGraph(filePath) {
  return basename(filePath) === 'graph.json';
}

// ── File discovery ───────────────────────────────────────────────────────────────────────────

function looksBinary(buf) {
  return buf.includes(0);
}

function walk(dir, root, acc) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(full, root, acc);
      continue;
    }
    if (!e.isFile()) continue;
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.size > MAX_FILE_BYTES) continue;
    let buf;
    try {
      buf = readFileSync(full);
    } catch {
      continue;
    }
    if (looksBinary(buf)) continue;
    if (buf.toString('utf8').includes(CONFLICT_TOKEN)) acc.push(full);
  }
  return acc;
}

/**
 * Every file under `root` that mentions the conflict token.
 *
 * `git grep` when the root is a checkout (fast, and `--untracked` covers files that were never
 * added), a filesystem walk otherwise. Both return absolute paths. Note this is a CANDIDATE list:
 * a file is only rewritten if it actually parses into complete conflict blocks.
 */
export function findCandidateFiles(root) {
  if (existsSync(join(root, '.git'))) {
    try {
      const out = execFileSync(
        'git',
        ['-C', root, 'grep', '--no-color', '-l', '-I', '-F', '--untracked', '-e', CONFLICT_TOKEN, '--', '.'],
        { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }
      );
      return out.split('\n').filter(Boolean).map((p) => join(root, p));
    } catch (err) {
      // `git grep` exits 1 for "no matches" — that is a clean result, not a failure.
      if (err && err.status === 1) return [];
      // Anything else (not a repo yet, git missing): fall back to the walk rather than give up,
      // because reporting "no markers" on a tool error is exactly the false green being hunted.
    }
  }
  return walk(root, root, []);
}

// ── Unmerged-path guard (#494) ────────────────────────────────────────────────────────────────
//
// `findCandidateFiles` searches for the CONFLICT TOKEN, which makes "this path is unmerged" and
// "this path carries markers" two different questions. The gap between them is a data-loss hole.
//
// On 2026-08-24 baselyserver's brain held `nexus/personal-brain/visits.log` as `UU` with all three
// stages present, ZERO markers, and 25 lines: a process had truncated and restarted the log after
// the merge stalled, and those 25 lines were disjoint from both merge sides (497 and 501 lines).
// This tool reported `candidates=0` and exited 0 — entirely honestly, there were no markers to
// repair. `repair-brain` then ran `git add -A` + `commit --no-edit`, which adopts whatever the
// working tree holds as the merge result, so a 25-entry log would have replaced a 502-entry one on
// every host, with a green exit code and an auto-closed alert.
//
// Two assertions close it. Both REFUSE rather than guess, and a refusal is a genuine fault that
// exits non-zero: we could not prove the result is lossless. Per the #467 convention that is RED,
// not a `::warning::` exit 0 — a warning here is indistinguishable from success to every caller.

/** A checkout, as far as this tool is concerned. Also true for a worktree, where `.git` is a file. */
export function isCheckout(root) {
  return existsSync(join(root, '.git'));
}

/**
 * Paths git reports as unmerged (`UU`, `AA`, `DU`, `UD`, …), repo-relative with forward slashes.
 *
 * Throws on a git failure rather than returning `[]`. "No unmerged paths" and "I could not ask"
 * must never render as the same answer — that is the false green this whole guard exists to end.
 */
export function unmergedPaths(root) {
  if (!isCheckout(root)) return [];
  const out = execFileSync('git', ['-C', root, 'diff', '--name-only', '--diff-filter=U'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return out.split('\n').filter(Boolean);
}

/**
 * One merge stage of a path: 1 = common ancestor, 2 = ours/HEAD, 3 = theirs/incoming.
 *
 * An absent stage is normal (add/add conflicts have no `:1:`, delete/modify has no `:2:` or `:3:`)
 * and is reported as `present: false`, which the superset check then has nothing to prove about.
 * A binary stage is reported separately, because a line-wise proof is meaningless for one and
 * silently skipping it would be a hole of exactly the shape being closed here.
 */
export function readStage(root, stage, rel) {
  let buf;
  try {
    buf = execFileSync('git', ['-C', root, 'show', `:${stage}:${rel}`], {
      maxBuffer: MAX_FILE_BYTES,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    return { present: false, binary: false, text: '' };
  }
  if (looksBinary(buf)) return { present: true, binary: true, text: '' };
  return { present: true, binary: false, text: buf.toString('utf8') };
}

/** Non-blank lines, with conflict-marker lines dropped. The unit every proof here is stated in. */
export function contentLines(text) {
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    .filter((l) => !RE_START.test(l) && !RE_BASE.test(l) && !RE_SEP.test(l) && !RE_END.test(l));
}

/**
 * Prove the working-tree copy of an unmerged path lost nothing, line-wise.
 *
 * Required to be present in the result: every content line of stage :2: (ours), stage :3:
 * (theirs), and — when supplied — the copy that was on disk BEFORE this tool rewrote it. That
 * third source is the one that matters for #494: the truncated `visits.log` content existed
 * nowhere else, so a union of ours and theirs alone would have dropped it silently.
 *
 * Stage :1: (the common ancestor) is deliberately NOT required, and asserting it would be a bug.
 * A legitimate merge routinely drops a base line — one side edits `salience: 0.3` to `0.5` and the
 * base value is correctly gone from the result. Requiring base ⊆ result would refuse ordinary
 * edits, which is worse than useless: a guard that cries wolf on healthy merges gets bypassed.
 * (Base ⊆ ours and base ⊆ theirs did hold for `visits.log`, and that is what proved it append-only
 * by hand — but it is evidence about one file, not an invariant to enforce on every file.)
 *
 * @param {string} root
 * @param {string} rel  repo-relative path
 * @param {string|null} priorText  the on-disk copy before this run rewrote it, if it did
 */
export function verifySuperset(root, rel, priorText = null) {
  const abs = join(root, rel);
  if (!existsSync(abs)) {
    return { ok: false, reason: 'the working-tree copy is missing, so the merge result cannot be proved lossless' };
  }
  let text;
  try {
    text = readFileSync(abs, 'utf8');
  } catch (err) {
    return { ok: false, reason: `unreadable, so the merge result cannot be proved lossless: ${err.message}` };
  }

  const have = new Set(contentLines(text));
  const missing = [];
  const checked = [];

  for (const stage of [2, 3]) {
    const s = readStage(root, stage, rel);
    if (!s.present) continue;
    if (s.binary) {
      return { ok: false, reason: `stage :${stage}: is binary — a line-wise superset cannot be proved` };
    }
    const lines = contentLines(s.text);
    const gone = lines.filter((l) => !have.has(l));
    checked.push({ source: stage === 2 ? 'ours' : 'theirs', lines: lines.length, missing: gone.length });
    for (const l of gone) missing.push({ source: stage === 2 ? 'ours' : 'theirs', line: l });
  }

  if (typeof priorText === 'string') {
    const lines = contentLines(priorText);
    const gone = lines.filter((l) => !have.has(l));
    checked.push({ source: 'worktree-before-repair', lines: lines.length, missing: gone.length });
    for (const l of gone) missing.push({ source: 'worktree-before-repair', line: l });
  }

  if (missing.length) {
    const sample = missing.slice(0, 3).map((m) => `${m.source}: ${m.line.slice(0, 120)}`);
    return {
      ok: false,
      reason:
        `the resolved file is missing ${missing.length} content line(s) that exist on a merge side ` +
        `or in the pre-repair working tree — refusing rather than commit a lossy merge. ` +
        `First: ${sample.join(' | ')}`,
      missing: missing.length,
      checked,
    };
  }

  return { ok: true, checked };
}

// ── Repair driver ────────────────────────────────────────────────────────────────────────────

/**
 * @param {string} root
 * @param {{check?: boolean}} [opts]
 * @returns {{root:string, scanned:number, files:Array<object>, repaired:number, blocks:number, unresolved:Array<object>, rebuildBrains:string[]}}
 */
export function repair(root, { check = false } = {}) {
  const candidates = findCandidateFiles(root);
  const files = [];
  const unresolved = [];
  const rebuildBrains = new Set();
  let repaired = 0;
  let blocks = 0;

  // Ask git which paths are unmerged BEFORE touching anything. A failure here is fatal to the
  // guard, so it is reported as unresolved (exit 1) rather than swallowed into an empty list.
  /** @type {string[]} */
  let unmerged = [];
  let unmergedKnown = true;
  try {
    unmerged = unmergedPaths(root);
  } catch (err) {
    unmergedKnown = false;
    unresolved.push({
      file: '(repository)',
      reason:
        `cannot list unmerged paths, so no merge result can be proved lossless: ${err.message}`,
    });
  }
  const unmergedSet = new Set(unmerged);

  // What each unmerged path held on disk before this run rewrote it. Only that pre-repair copy can
  // witness content that exists on neither merge side — the #494 shape.
  /** @type {Map<string,string>} */
  const priorText = new Map();
  /** @type {Map<string,object>} */
  const handled = new Map();

  for (const filePath of candidates) {
    let text;
    try {
      text = readFileSync(filePath, 'utf8');
    } catch (err) {
      unresolved.push({ file: filePath, reason: `unreadable: ${err.message}` });
      continue;
    }

    const rel = relative(root, filePath).split(sep).join('/');
    if (unmergedSet.has(rel)) priorText.set(rel, text);

    if (isGeneratedGraph(filePath)) {
      const parsed = parseSegments(text);
      const conflictCount = parsed.segments.filter((s) => s.type === 'conflict').length;
      if (conflictCount === 0) {
        // Mentions the token but has no complete block — could still be invalid JSON, which is a
        // separate problem, so say so rather than silently passing.
        let ok = true;
        try {
          JSON.parse(text);
        } catch {
          ok = false;
        }
        if (!ok) unresolved.push({ file: rel, reason: 'graph.json is not valid JSON and has no conflict blocks to resolve' });
        continue;
      }
      blocks += conflictCount;
      const picked = resolveGeneratedJson(text);
      if (!picked) {
        unresolved.push({
          file: rel,
          reason: `neither side of ${conflictCount} conflict block(s) parses as a graph — rebuild from nodes/ instead`,
        });
        continue;
      }
      const entry = { file: rel, strategy: 'generated', side: picked.side, blocks: conflictCount };
      files.push(entry);
      handled.set(rel, entry);
      rebuildBrains.add(relative(root, join(filePath, '..')).split(sep).join('/'));
      if (!check) {
        writeFileSync(filePath, picked.text, 'utf8');
        repaired++;
      }
      continue;
    }

    const result = resolveText(text);
    if (!result.changed) continue; // token present but no complete block: leave it alone
    blocks += result.blocks;
    const entry = {
      file: rel,
      strategy: 'lines',
      blocks: result.blocks,
      dateBlocks: result.dateBlocks,
      unionBlocks: result.unionBlocks,
    };
    files.push(entry);
    handled.set(rel, entry);
    if (!check) {
      writeFileSync(filePath, result.text, 'utf8');
      repaired++;
    }
  }

  // ── The #494 guard, over every unmerged path ────────────────────────────────────────────────
  //
  // Runs AFTER the repair loop so the superset proof sees the content a caller is about to
  // `git add`. In --check mode nothing was written, so there is nothing to prove about a file we
  // would have rewritten; the "unmerged but marker-free" half still applies, because that verdict
  // is about git's index and not about anything this tool wrote.
  /** @type {Array<object>} */
  const mergeChecks = [];
  if (unmergedKnown) {
    for (const rel of unmerged) {
      const entry = handled.get(rel);

      if (!entry) {
        // THE HOLE. Unmerged, yet no complete conflict block was found — so nothing here knows what
        // the merge result should be, and `git add -A` would adopt the working-tree copy verbatim.
        mergeChecks.push({ file: rel, verdict: 'refused', reason: 'unmerged with no conflict markers' });
        unresolved.push({
          file: rel,
          reason:
            'unmerged in the index but carries no complete conflict block, so the merge result ' +
            'cannot be determined. Do NOT `git add` it: the working-tree copy may be unrelated to ' +
            'either merge side (this is #494 — a truncated log presented exactly this way). ' +
            `Inspect the three stages with: git show :1:${rel} / :2:${rel} / :3:${rel}`,
        });
        continue;
      }

      if (entry.strategy === 'generated') {
        // One side is kept on purpose, so a superset proof is meaningless here — graph.json is
        // generated and `graph-init.js` rebuilds it from nodes/. Recorded, not asserted.
        mergeChecks.push({ file: rel, verdict: 'exempt-generated' });
        continue;
      }

      if (entry.dateBlocks > 0) {
        // Rule 1 drops a line by design: two `created:` values collapse to the earlier one. That is
        // the intended resolution, so the strict proof cannot apply. Recorded so it is visible.
        mergeChecks.push({ file: rel, verdict: 'exempt-date-rule', dateBlocks: entry.dateBlocks });
        continue;
      }

      if (check) {
        mergeChecks.push({ file: rel, verdict: 'not-proved-check-mode' });
        continue;
      }

      const proof = verifySuperset(root, rel, priorText.get(rel) ?? null);
      if (!proof.ok) {
        mergeChecks.push({ file: rel, verdict: 'refused', reason: proof.reason, checked: proof.checked });
        unresolved.push({ file: rel, reason: proof.reason });
        continue;
      }
      mergeChecks.push({ file: rel, verdict: 'proved-lossless', checked: proof.checked });
    }
  }

  return {
    root,
    scanned: candidates.length,
    files,
    repaired,
    blocks,
    unresolved,
    unmerged,
    unmergedKnown,
    mergeChecks,
    rebuildBrains: [...rebuildBrains].sort(),
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────

export function defaultRoot() {
  return join(homedir(), 'agent-memory');
}

export function main(argv) {
  const flags = parseFlags(argv, {
    usage: USAGE,
    allowed: ['check', 'root', 'json', 'quiet'],
  });
  if (flags === null) return argv.includes('-h') || argv.includes('--help') ? 0 : 2;

  const root = resolvePath(
    typeof flags.root === 'string' && flags.root ? flags.root.replace(/^~(?=$|[/\\])/, homedir()) : defaultRoot()
  );
  if (!existsSync(root)) {
    process.stderr.write(`resolve-brain-markers: no such directory: ${root}\n`);
    return 2;
  }

  const check = !!flags.check;
  const report = repair(root, { check });

  if (flags.json) {
    process.stdout.write(JSON.stringify({ mode: check ? 'check' : 'repair', ...report }, null, 2) + '\n');
  } else {
    if (!flags.quiet) {
      for (const f of report.files) {
        const detail =
          f.strategy === 'generated'
            ? `generated → kept ${f.side} side, rebuild required`
            : `${f.blocks} block(s): ${f.dateBlocks} date, ${f.unionBlocks} union`;
        process.stdout.write(`${check ? 'would repair' : 'repaired'}  ${f.file}  [${detail}]\n`);
      }
      for (const m of report.mergeChecks || []) {
        const detail = m.checked
          ? m.checked.map((c) => `${c.source}=${c.lines} missing=${c.missing}`).join(' ')
          : m.reason || '';
        process.stdout.write(`merge-check  ${m.file}  ${m.verdict}${detail ? `  [${detail}]` : ''}
`);
      }
      for (const u of report.unresolved) {
        process.stdout.write(`UNRESOLVED  ${u.file}  ${u.reason}\n`);
      }
    }
    process.stdout.write(
      `resolve-brain-markers: root=${report.root} candidates=${report.scanned} ` +
        `unmerged=${report.unmergedKnown ? report.unmerged.length : 'unknown'} ` +
        `files-with-conflicts=${report.files.length} blocks=${report.blocks} ` +
        `${check ? 'written=0 (--check)' : `written=${report.repaired}`} ` +
        `unresolved=${report.unresolved.length}\n`
    );
    if (report.rebuildBrains.length) {
      process.stdout.write(
        `resolve-brain-markers: rebuild these generated graphs from nodes/ before trusting them: ` +
          `${report.rebuildBrains.join(', ')}\n`
      );
    }
  }

  if (report.unresolved.length) return 1;
  if (check && report.files.length) return 1;
  return 0;
}

if (isMainModule(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
