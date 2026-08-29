// gmail.js — inbound adapter for Gmail.
//
// Design: docs/superpowers/specs/2026-08-22-inbound-event-triage-design.md
//
// Pure: calls Gmail MCP and normalizes the result. No model call, no dispatch, no event-bus
// knowledge. The MCP client is injected (createClientImpl) so tests run against stubs with no network.
//
// Authentication: reads GOOGLE_OAUTH_ACCESS_TOKEN and validates before constructing a client.
// A missing token fails loudly so the poller can alert (#263).
//
// Cursor: timestamp-based monotonic watermark. First run caps at one page (last 24h) to avoid
// dragging in the entire mailbox. The adapter returns the next watermark and optionally a new
// page cursor if pagination is in flight.

import { createClient, validateToken } from '../mcp-client.js';
import { normalizeEnvelope, truncateBody } from './envelope.js';

const GMAIL_MCP_URL = 'https://gmailmcp.googleapis.com/mcp/v1';
const PAGE_SIZE = 50;

/**
 * Extract email address from a From header.
 * Gmail sends "Display Name <addr@example.com>" or just "addr@example.com".
 * Extract the address, trim, normalize to lowercase.
 * Return empty string on malformed input.
 */
export function extractEmailAddress(fromHeader) {
  if (!fromHeader || typeof fromHeader !== 'string') return '';
  const trimmed = fromHeader.trim();
  if (trimmed === '') return '';

  // Check for angle bracket format: "Name <addr@example.com>"
  const match = trimmed.match(/<([^>]+)>/);
  if (match && match[1]) {
    return match[1].trim().toLowerCase();
  }

  // No brackets — assume it's a bare address
  return trimmed.toLowerCase();
}

/**
 * Check if an email address matches an allowlist entry.
 * Allowlist entries can be:
 *   - exact address: "addr@example.com" (case-insensitive)
 *   - domain rule: "@example.com" (matches any address at that domain)
 *
 * @param {string} address - Extracted email address (normalized to lowercase)
 * @param {string} allowlistEntry - Entry from senders_allow (normalized to lowercase)
 * @returns {boolean} true if address matches the entry
 */
export function addressMatches(address, allowlistEntry) {
  if (!address || !allowlistEntry) return false;

  const addr = address.toLowerCase().trim();
  const entry = allowlistEntry.toLowerCase().trim();

  // Domain rule: entry starts with @
  if (entry.startsWith('@')) {
    const domain = entry.slice(1); // Remove the @
    if (!domain) return false; // Just "@" matches nothing

    // Address must end with the domain (case-insensitive)
    // "@example.com" matches "user@example.com" but NOT "user@notexample.com"
    // or "user@example.com.evil.tld"
    return addr.endsWith(`@${domain}`);
  }

  // Exact match (case-insensitive, already lowercased)
  return addr === entry;
}

/**
 * Create a default Gmail MCP client from the env var token.
 */
export function defaultCreateClient() {
  const token = process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
  validateToken(token, 'GOOGLE_OAUTH_ACCESS_TOKEN');
  return createClient({
    url: GMAIL_MCP_URL,
    token,
  });
}

/**
 * Filter and flatten Gmail message search results.
 *
 * Checks senders_allow (allowlist, fails closed) and labels_ignore.
 * Allowlist entries can be exact addresses or domain rules (prefixed with @).
 * Returns an array of { messageId, threadId, from, subject, timestamp, labels }.
 */
export function filterMessages(messages, policy) {
  const sendersAllow = (policy && policy.sendersAllow) || [];
  const labelsIgnore = (policy && policy.labelsIgnore) || [];

  // Fail closed: empty allowlist yields nothing.
  if (sendersAllow.length === 0) {
    return [];
  }

  const out = [];
  for (const msg of (messages || [])) {
    if (!msg || typeof msg !== 'object') continue;

    const fromHeader = msg.from || '';
    const labels = (msg.labels && Array.isArray(msg.labels)) ? msg.labels : [];

    // Extract and normalize the email address from the From header.
    const address = extractEmailAddress(fromHeader);
    if (!address) continue; // Malformed From header

    // Check allowlist: address must match at least one entry.
    if (!sendersAllow.some((entry) => addressMatches(address, entry))) continue;

    // Check ignore list.
    if (labels.some((l) => labelsIgnore.includes(l))) continue;

    out.push({
      messageId: msg.id || '',
      threadId: msg.threadId || msg.id || '',
      from: address,
      subject: msg.subject || '(no subject)',
      timestamp: msg.timestamp || new Date().toISOString(),
      labels,
      body: msg.body || '',
    });
  }

  return out;
}

/**
 * Gmail message ID is stable across polls and is the dedupe key.
 */
export function externalIdFor(message) {
  return `gmail-${message.messageId}`;
}

/**
 * Deep link to Gmail message in the browser.
 */
export function urlFor(message) {
  if (message.messageId) {
    return `https://mail.google.com/mail/u/0/#inbox/${message.messageId}`;
  }
  return 'https://mail.google.com/mail/u/0/#inbox';
}

/**
 * Normalize one message to an envelope.
 */
function toEnvelope(message) {
  return normalizeEnvelope({
    source: 'gmail',
    externalId: externalIdFor(message),
    ts: message.timestamp,
    actor: message.from,
    subject: message.subject,
    body: truncateBody(message.body),
    url: urlFor(message),
  });
}

/**
 * Poll Gmail once.
 *
 * Returns { items: Envelope[], cursor }.
 *
 * The cursor advances to the latest item's timestamp. On first run (no cursor), caps at one page
 * (last 24h) to avoid dragging in the entire mailbox. A transport or auth error throws.
 *
 * @param {string} cursor - Optional ISO timestamp from the last poll
 * @param {Object} policy - Policy block: { sendersAllow, labelsIgnore, ... }
 * @param {Function} [createClientImpl] - Injected client factory (default: defaultCreateClient)
 * @returns {{ items: Envelope[], cursor: string }}
 */
export async function poll({ cursor = null, policy, createClientImpl = defaultCreateClient } = {}) {
  const client = createClientImpl();

  // Initialize the session.
  await client.initialize();

  // Build search query. First run uses a time-based limit to bound the page.
  let query = 'is:unread';

  if (cursor) {
    // Subsequent runs: use cursor as a timestamp watermark.
    query = `is:unread after:${cursor}`;
  } else {
    // First run: limit to the last 24 hours to avoid the whole inbox.
    const oneDay = 24 * 60 * 60 * 1000;
    const cutoff = new Date(Date.now() - oneDay);
    query = `is:unread after:${cutoff.toISOString().split('T')[0]}`;
  }

  // Search for matching threads.
  const threads = await client.callTool('search_threads', {
    query,
    pageSize: PAGE_SIZE,
  });

  if (!Array.isArray(threads)) {
    throw new Error('search_threads did not return an array');
  }

  // Fetch full details for each thread (includes messages).
  const messages = [];
  for (const thread of threads) {
    if (!thread || typeof thread !== 'object') continue;

    const threadId = thread.id || '';
    let threadDetail;
    try {
      threadDetail = await client.callTool('get_thread', { threadId });
    } catch (err) {
      // One bad thread does not stop the rest.
      continue;
    }

    if (!threadDetail || typeof threadDetail !== 'object') continue;

    // Extract messages from thread. Flatten to envelope-compatible format.
    const threadMessages = threadDetail.messages || [];
    for (const msg of threadMessages) {
      if (!msg || typeof msg !== 'object') continue;

      messages.push({
        id: msg.id || threadId,
        threadId,
        from: msg.from || threadDetail.from || '',
        subject: msg.subject || threadDetail.subject || '(no subject)',
        timestamp: msg.timestamp || threadDetail.timestamp || new Date().toISOString(),
        labels: threadDetail.labels || [],
        body: msg.body || msg.snippet || '',
      });
    }
  }

  // Apply policy filters.
  const filtered = filterMessages(messages, policy);

  // Normalize to envelopes.
  const items = [];
  const invalid = [];
  for (const msg of filtered) {
    try {
      items.push(toEnvelope(msg));
    } catch (err) {
      invalid.push({ id: msg.messageId, error: err.message });
    }
  }

  // Sort oldest first.
  items.sort((a, b) => a.ts.localeCompare(b.ts));

  // Advance cursor to the latest timestamp. If no items, cursor stays.
  let nextCursor = cursor;
  if (items.length > 0) {
    const latest = items[items.length - 1];
    nextCursor = latest.ts;
  }

  return {
    items,
    cursor: nextCursor || cursor,
  };
}
