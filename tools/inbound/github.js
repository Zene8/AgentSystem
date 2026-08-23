// github.js — inbound adapter for GitHub notifications.
//
// Design: docs/superpowers/specs/2026-08-22-inbound-event-triage-design.md
//
// Phase 2's source on purpose: zero new auth (gh is already installed and authenticated on every
// host that runs this), zero personal data, and a misfire costs a junk draft PR rather than
// reaching outside the owner's own machines.
//
// Pure in the sense the spec means it: it calls the GitHub API and normalizes the result. It makes
// no model call, publishes nothing, knows nothing about the event bus, and never advances a cursor
// itself — the poller does that after a successful publish. The API call is injected (`runGh`), so
// every test below runs against stubbed responses with no network.

import { spawnSync } from 'node:child_process';

import { normalizeEnvelope, truncateBody } from './envelope.js';

// One page is deliberate. A tier fires every 10 minutes; if 50 notifications arrived inside one
// window, the next fire picks up the rest, and the cursor only advances past what was published.
// Paginating instead would let one bad morning publish hundreds of items in a single pass.
export const PAGE_SIZE = 50;

// `ci_activity` fires for every finished check suite, success included. Only failures are worth a
// triage verdict, and GitHub does not offer a conclusion filter on the notifications endpoint, so
// the title is the only signal available without a second API call per item.
const FAILURE_TITLE = /\b(fail(ed|ure|ing)?|error(ed|s)?|cancell?ed|timed out)\b/i;

/**
 * Run one `gh api` call and parse the JSON body.
 *
 * Throws with the stderr line on a non-zero exit, so an expired or unauthenticated `gh` surfaces
 * as an adapter error the poller can alert on (#263 is this exact shape for Beeper, failing
 * silently today).
 */
export function defaultRunGh(args) {
  const res = spawnSync('gh', args, { encoding: 'utf8', windowsHide: true });
  if (res.error) throw new Error(`gh could not be run: ${res.error.message}`);
  if (res.status !== 0) {
    const detail = String(res.stderr || res.stdout || '').trim().split('\n')[0] || `exit ${res.status}`;
    throw new Error(`gh api failed: ${detail}`);
  }
  try {
    return JSON.parse(res.stdout || '[]');
  } catch (err) {
    throw new Error(`gh api returned unparseable JSON: ${err.message}`);
  }
}

/**
 * The API path for one poll. `since` is the cursor; GitHub treats it as inclusive, which is
 * precisely why the cursor store keeps a `seenIds` ring behind it.
 *
 * `all=false` keeps it to unread threads and `participating=false` keeps org-wide activity in
 * scope — narrowing happens in policy (`reasons`), not in the query, so retuning what gets
 * triaged does not need a deploy.
 */
export function notificationsPath(cursor, { pageSize = PAGE_SIZE } = {}) {
  const params = [`per_page=${pageSize}`, 'all=false', 'participating=false'];
  if (cursor) params.push(`since=${encodeURIComponent(cursor)}`);
  return `notifications?${params.join('&')}`;
}

/**
 * The dedupe key: thread id plus the update that produced this item.
 *
 * The thread id alone is stable but too coarse — GitHub reuses it for every later comment on the
 * same issue, so the seenIds ring would swallow genuinely new activity on a thread already seen.
 * `updated_at` alone is not unique. The pair is stable across polls (a re-poll of the same state
 * yields the same key) and moves when there is something new, which is exactly the contract the
 * envelope requires.
 */
export function externalIdFor(notification) {
  return `gh-${notification.id}-${Date.parse(notification.updated_at) || 0}`;
}

/**
 * A human-openable link. GitHub hands back API URLs, and for a CheckSuite hands back nothing at
 * all, so the repo's Actions tab is the fallback rather than an empty `url` — which
 * normalizeEnvelope would reject, dropping a real CI failure over a cosmetic field.
 */
export function htmlUrlFor(notification) {
  const apiUrl = notification.subject && notification.subject.url;
  const repo = (notification.repository && notification.repository.full_name) || '';
  if (typeof apiUrl === 'string' && apiUrl.startsWith('https://api.github.com/repos/')) {
    return apiUrl
      .replace('https://api.github.com/repos/', 'https://github.com/')
      .replace('/pulls/', '/pull/');
  }
  if (repo) return `https://github.com/${repo}/actions`;
  return 'https://github.com/notifications';
}

/**
 * Is this notification worth an envelope at all?
 *
 * Two gates, in this order:
 *   1. `reason` must be listed in policy. An empty list matches nothing — fail-closed, same as
 *      every other allowlist in this system.
 *   2. A `ci_activity` item must also look like a failure. A green build is not triage.
 */
export function isInteresting(notification, policy) {
  const reasons = (policy && policy.reasons) || [];
  if (!reasons.includes(notification.reason)) return false;
  if (notification.reason === 'ci_activity') {
    const title = (notification.subject && notification.subject.title) || '';
    return FAILURE_TITLE.test(title);
  }
  return true;
}

function toEnvelope(notification) {
  const repo = (notification.repository && notification.repository.full_name) || 'unknown/unknown';
  const subject = (notification.subject && notification.subject.title) || '(no title)';
  const type = (notification.subject && notification.subject.type) || 'Unknown';
  return normalizeEnvelope({
    source: 'github',
    externalId: externalIdFor(notification),
    ts: notification.updated_at,
    // The triggering repository, not a user: GitHub does not report an actor on a notification,
    // and inventing one from the title would put a guess into a classifier prompt.
    actor: repo,
    subject: `[${notification.reason}] ${subject}`,
    body: truncateBody(`repo: ${repo}\nreason: ${notification.reason}\ntype: ${type}\ntitle: ${subject}`),
    url: htmlUrlFor(notification),
  });
}

/**
 * Poll GitHub notifications once.
 *
 * Returns `{ items, cursor }`. The cursor is the newest `updated_at` observed on this pass —
 * including items the policy filtered out, so a stream of uninteresting notifications cannot pin
 * the cursor in place and make every later poll re-read them.
 *
 * An item that fails envelope validation is skipped and counted in `skipped`, not thrown: one
 * malformed notification must not stop the other 49 from being triaged. A transport or auth
 * failure DOES throw, because that is not one bad item, it is the adapter being broken.
 */
export function poll({ cursor = null, policy, runGh = defaultRunGh, pageSize = PAGE_SIZE } = {}) {
  const raw = runGh(['api', notificationsPath(cursor, { pageSize })]);
  if (!Array.isArray(raw)) {
    throw new Error('gh api notifications did not return an array');
  }

  const items = [];
  const invalid = [];
  let newest = cursor ? Date.parse(cursor) || 0 : 0;

  for (const notification of raw) {
    if (!notification || typeof notification !== 'object') continue;
    const updated = Date.parse(notification.updated_at) || 0;
    if (updated > newest) newest = updated;
    if (!isInteresting(notification, policy)) continue;
    try {
      items.push(toEnvelope(notification));
    } catch (err) {
      invalid.push({ id: notification.id, error: err.message });
    }
  }

  // Oldest first, so the queue drains in the order things actually happened.
  items.sort((a, b) => a.ts.localeCompare(b.ts));

  return {
    items,
    cursor: newest ? new Date(newest).toISOString() : cursor,
    seen: raw.length,
    invalid,
  };
}
