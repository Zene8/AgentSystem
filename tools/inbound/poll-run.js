// poll-run.js — one poll of one inbound source.
//
// Design: docs/superpowers/specs/2026-08-22-inbound-event-triage-design.md
//
//   load policy -> load cursor -> adapter.poll() -> drop seen -> publish 'inbound-item' -> save cursor
//
// This is the whole poller. It is a one-shot process, not a daemon: a systemd tier timer runs it
// per enabled source, so a crash is one missed poll instead of a dead service, and there is no
// long-lived process holding a stale policy in memory.
//
// Cursor discipline is the point of the ordering above. The cursor is written ONLY after every item
// on the pass has been published to the durable bus. Advancing first and publishing second would
// lose items to any crash in between, and the bus is exactly what makes a lost item impossible —
// see event-bus.js.
//
// Usage:
//   node tools/inbound/poll-run.js --source=github            # poll and publish
//   node tools/inbound/poll-run.js --source=github --dry-run   # print what would publish
//   node tools/inbound/poll-run.js --cadence=medium            # every enabled source in that tier
//   node tools/inbound/poll-run.js --source=github --alert     # raise/resolve the failure alert
//
// Exit codes:
//   0  polled (including "policy disables this source" — that is a configuration state, not a fault)
//   1  bad usage
//   3  adapter or cursor failure, alerted if --alert

import { hostname } from 'node:os';

import { isMainModule } from '../is-main.js';
import { publish } from '../event-bus.js';
import { SOURCES } from './envelope.js';
import { loadPolicy, sourcesForCadence, CADENCE_TIERS } from './policy.js';
import { readCursor, advanceCursor, dropSeen } from './cursor.js';
import { withTriageLock, deferredMessage } from './with-lock.js';
import * as githubAdapter from './github.js';

// Adapters land here as they are built. A source with a policy section but no adapter yet is a
// no-op with a stated reason, never a crash — the policy file is edited by hand and may well be
// ahead of the code.
export const ADAPTERS = {
  github: githubAdapter,
};

export const ALERT_KEY_PREFIX = 'inbound-poll-failed';

// Per host AND per source, for the same reason the brain-sync keys are per host: a broken Gmail
// token on the laptop and a broken GitHub token on the runner are two different people-tasks, and
// one shared key lets whoever fixes the second one close the first one's issue.
export function alertKey(source, host = hostname()) {
  return `${ALERT_KEY_PREFIX}-${source}-${host}`;
}

/**
 * Poll one source. Returns a result object rather than exiting, so it is testable and so
 * --cadence can run several sources and still report on each.
 *
 * `deps` exists for tests only: it injects the adapter, the publisher and the cursor store.
 */
export function pollSource(source, {
  dryRun = false,
  env = process.env,
  policyPath,
  adapters = ADAPTERS,
  publisher = publish,
  cursorStore = { readCursor, advanceCursor },
} = {}) {
  if (!SOURCES.includes(source)) {
    throw new Error(`unknown source "${source}" — allowed: ${SOURCES.join(', ')}`);
  }

  const policy = loadPolicy(source, { env, path: policyPath });
  if (!policy.enabled) {
    return { source, status: 'disabled', reason: policy.reason, published: 0 };
  }

  const adapter = adapters[source];
  if (!adapter || typeof adapter.poll !== 'function') {
    return { source, status: 'no-adapter', reason: `no adapter implemented for "${source}"`, published: 0 };
  }

  // A corrupt cursor throws here, before any API call. That ordering is deliberate: refusing to
  // poll is the correct response, because treating the cursor as absent would re-read the source
  // from the beginning and re-action all of it.
  const state = cursorStore.readCursor(source);

  let result;
  try {
    result = adapter.poll({ cursor: state.cursor, policy });
  } catch (err) {
    return { source, status: 'error', reason: err.message, published: 0 };
  }

  const fresh = dropSeen(result.items || [], state.seenIds);

  if (dryRun) {
    return {
      source,
      status: 'dry-run',
      published: 0,
      seen: result.seen ?? null,
      fresh: fresh.length,
      cursorWas: state.cursor,
      cursorWouldBe: result.cursor,
      items: fresh,
      invalid: result.invalid || [],
    };
  }

  const publishedIds = [];
  try {
    for (const envelope of fresh) {
      // `_sensitive` is what makes event-bus.js redact this payload out of done.jsonl and
      // dead-letter.jsonl. The queue file keeps the full body — the classifier needs it — but those
      // two logs sync to every host through the brain repo, and an email body has no business
      // there. The handler's own record (verdict, url, actor) is what lands instead.
      publisher({ type: 'inbound-item', source: `inbound/${source}`, payload: { _sensitive: true, envelope } });
      publishedIds.push(envelope.externalId);
    }
  } catch (err) {
    // Partial publish: the cursor is advanced past exactly what did land, so the next poll retries
    // the remainder instead of either losing it or replaying the whole page.
    if (publishedIds.length) {
      cursorStore.advanceCursor(source, { cursor: state.cursor, seenIds: publishedIds });
    }
    return { source, status: 'error', reason: `publish failed: ${err.message}`, published: publishedIds.length };
  }

  cursorStore.advanceCursor(source, { cursor: result.cursor, seenIds: publishedIds });

  return {
    source,
    status: 'ok',
    published: publishedIds.length,
    seen: result.seen ?? null,
    fresh: fresh.length,
    cursor: result.cursor,
    invalid: result.invalid || [],
  };
}

export function parseArgs(argv) {
  const opts = { source: null, cadence: null, dryRun: false, alert: false, json: false };
  for (const arg of argv) {
    if (arg.startsWith('--source=')) opts.source = arg.slice('--source='.length);
    else if (arg.startsWith('--cadence=')) opts.cadence = arg.slice('--cadence='.length);
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--alert') opts.alert = true;
    else if (arg === '--json') opts.json = true;
    else throw new Error(`unknown argument "${arg}"`);
  }
  if (!opts.source && !opts.cadence) throw new Error('one of --source=<s> or --cadence=<tier> is required');
  if (opts.source && opts.cadence) throw new Error('--source and --cadence are mutually exclusive');
  if (opts.cadence && !CADENCE_TIERS.includes(opts.cadence)) {
    throw new Error(`unknown cadence "${opts.cadence}" — allowed: ${CADENCE_TIERS.join(', ')}`);
  }
  if (opts.source && !SOURCES.includes(opts.source)) {
    throw new Error(`unknown source "${opts.source}" — allowed: ${SOURCES.join(', ')}`);
  }
  return opts;
}

function describe(r) {
  if (r.status === 'ok') return `${r.source}: published ${r.published} of ${r.fresh} fresh (${r.seen} seen)`;
  if (r.status === 'dry-run') return `${r.source}: dry-run, ${r.fresh} fresh of ${r.seen} seen, cursor ${r.cursorWas} -> ${r.cursorWouldBe}`;
  return `${r.source}: ${r.status} — ${r.reason}`;
}

async function alertFor(results, dryRun) {
  const { raise, resolve } = await import('../human-needed.js');
  for (const r of results) {
    const key = alertKey(r.source);
    if (r.status === 'error') {
      raise({
        key,
        title: `inbound poller for ${r.source} is failing on ${hostname()}`,
        // No item content here. An alert body is a public GitHub issue; the reason string comes
        // from an adapter's own error, never from a polled item.
        why: `tools/inbound/poll-run.js --source=${r.source} failed: ${r.reason}`,
        action: `On ${hostname()}, run: node tools/inbound/poll-run.js --source=${r.source} --dry-run`,
        source: 'inbound/poll-run.js',
        dryRun,
      });
    } else if (r.status === 'ok') {
      resolve({ key, comment: `inbound poller for ${r.source} polled cleanly on ${hostname()}`, dryRun });
    }
  }
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`poll-run: ${err.message}`);
    process.exit(1);
  }

  const sources = opts.source
    ? [opts.source]
    : sourcesForCadence(opts.cadence).map(p => p.source);

  if (!sources.length) {
    console.log(`no enabled sources in cadence tier "${opts.cadence}"`);
    return;
  }

  // A dry run reads and prints; it advances no cursor and publishes nothing, so it does not need
  // the lock and must stay usable for diagnosis while a stage-2 run is mid-flight.
  const pass = () => {
    const results = [];
    for (const source of sources) {
      try {
        results.push(pollSource(source, { dryRun: opts.dryRun }));
      } catch (err) {
        // Thrown, not returned: a corrupt cursor or an unset $LIFE_REPO. Both are hard stops.
        results.push({ source, status: 'error', reason: err.message, published: 0 });
      }
    }
    return results;
  };

  let results;
  if (opts.dryRun) {
    results = pass();
  } else {
    const held = withTriageLock(pass);
    if (!held.ran) {
      console.log(deferredMessage(held.holder));
      return;
    }
    results = held.result;
  }

  if (opts.json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    for (const r of results) console.log(describe(r));
  }

  if (opts.alert) await alertFor(results, false);

  if (results.some(r => r.status === 'error')) process.exit(3);
}

if (isMainModule(import.meta.url)) await main();
