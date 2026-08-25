// beeper.js — inbound adapter for Beeper/Matrix chat messages.
//
// Design: docs/superpowers/specs/2026-08-22-inbound-event-triage-design.md
//
// Polls the Beeper MCP endpoint for recent messages, filters by allowed chats, and normalizes
// them to envelope shape. Auth is via BEEPER_ACCESS_TOKEN env var; a missing or expired token
// surfaces as a thrown adapter error, never as silent success. The client is injected so every
// test runs against stubs with zero network.
//
// Note: BEEPER_ACCESS_TOKEN was expired as of 2026-08-05 (#263). Live testing is not possible
// until the token is refreshed. All tests below run against mocked responses.

import { createClient, validateToken } from '../mcp-client.js';
import { normalizeEnvelope, truncateBody } from './envelope.js';

// One page of messages. Bounded to prevent first poll from replaying entire chat history.
export const PAGE_SIZE = 50;

/**
 * Default factory for creating a real Beeper MCP client.
 * Validates token and creates client with Beeper's HTTP MCP endpoint.
 */
export async function defaultClientFactory(opts = {}) {
  const baseUrl = opts.baseUrl || process.env.BEEPER_API_URL || 'http://100.82.195.75:23373';
  const token = opts.token || process.env.BEEPER_ACCESS_TOKEN;
  const fetchImpl = opts.fetchImpl;

  validateToken(token, 'BEEPER_ACCESS_TOKEN');

  const client = createClient({
    url: `${baseUrl}/v0/mcp`,
    token,
    fetchImpl,
  });

  await client.initialize();
  return client;
}

/**
 * Is this chat in the allowlist?
 *
 * The allowlist is fail-closed: empty or missing yields ZERO items. This is load-bearing —
 * it is the outer gate that prevents accidentally polling all chats.
 *
 * Matching strategy: entries are matched in order of stability and security.
 * - Bare entries or "id:" prefix: match on stable chat/room ID only (recommended, not spoofable)
 * - "name:" prefix: match on display name — spoofable by anyone who can rename the room
 *
 * Example allowlist:
 *   chats_allow: [room_id_123, "id:room_id_456", "name:Family"]
 *
 * SECURITY: A chat can be spoofed by renaming if you match on display name.
 * Match on ID (bare or id: prefix) to prevent third-party spoofing.
 */
export function isAllowed(chatId, chatName, chatsAllow = []) {
  if (!Array.isArray(chatsAllow) || chatsAllow.length === 0) {
    return false;
  }

  for (const entry of chatsAllow) {
    // Explicit ID match: "id:room_id_123" or bare "room_id_123"
    if (entry.startsWith('id:')) {
      if (chatId === entry.slice(3)) return true;
    } else if (!entry.includes(':')) {
      // Bare entry without colon: treat as ID (stable, not spoofable)
      if (chatId === entry) return true;
    } else if (entry.startsWith('name:')) {
      // Explicit name match: "name:Family" — spoofable warning in doc above
      if (chatName === entry.slice(5)) return true;
    }
  }

  return false;
}

/**
 * Create a stable, source-native externalId.
 *
 * The Beeper message ID is already stable and unique. Matrix uses the event ID which is
 * stable across syncs and polls.
 */
export function externalIdFor(message) {
  // Beeper messages have an 'id' field that is the Matrix event_id
  return `beeper-${message.id || message.event_id || 'unknown'}`;
}

/**
 * A human-openable deep link to the message.
 *
 * Beeper provides message URLs in the response. If not available, use a fallback to the
 * chat page.
 */
export function urlFor(message, chatName) {
  if (message.url) return message.url;
  // Fallback: deep link to the chat by name (Matrix room convention)
  if (chatName) return `https://app.beeper.com/chat/${encodeURIComponent(chatName)}`;
  return 'https://app.beeper.com';
}

/**
 * Is this message worth an envelope at all?
 *
 * Gate on chat allowlist. Redacted messages, reactions, and tombstones are metadata only.
 */
export function isInteresting(message, policy) {
  const chatsAllow = (policy && policy.chatsAllow) || [];

  // Get stable chat ID and display name
  const chatId = message.chat_id || message.room_id || '';
  const chatName = message.chat_name || message.room_name || '';

  // Empty allowlist is fail-closed
  if (!isAllowed(chatId, chatName, chatsAllow)) {
    return false;
  }

  // Skip redacted, reactions, and other metadata
  if (message.type && !message.type.startsWith('m.room.message')) {
    return false;
  }

  // Skip if no body
  if (!message.body && !message.content) {
    return false;
  }

  return true;
}

/**
 * Convert a message to an envelope, or throw if the timestamp is unparseable.
 *
 * DO NOT invent timestamps. Messages without a real timestamp are dropped from the batch.
 * A fabricated timestamp would advance the cursor past real messages, causing silent data loss.
 */
function toEnvelope(message, chatName) {
  const sender = message.sender || message.author || '(unknown)';
  const body = message.body || (message.content && message.content.body) || '';
  const subject = `[${chatName}] ${sender}`;

  // Handle timestamp: prefer ISO string, fall back to millisecond timestamp
  // DO NOT fall back to current time — that would advance the cursor past real data.
  let ts = message.timestamp;
  if (!ts && message.origin_server_ts) {
    // origin_server_ts is in milliseconds; convert to ISO string
    const numMs = typeof message.origin_server_ts === 'number'
      ? message.origin_server_ts
      : Number(message.origin_server_ts);
    if (!Number.isNaN(numMs) && numMs > 0) {
      ts = new Date(numMs).toISOString();
    }
  }

  // Throw if we have no timestamp — this message will be dropped from the batch.
  if (!ts) {
    throw new Error('message has no parseable timestamp');
  }

  return normalizeEnvelope({
    source: 'beeper',
    externalId: externalIdFor(message),
    ts,
    actor: sender,
    subject,
    body: truncateBody(body),
    url: urlFor(message, chatName),
  });
}

/**
 * Poll Beeper messages once.
 *
 * The client may be injected (for testing) or created fresh (production).
 * Returns `{ items, cursor, seen, invalid }`.
 *
 * Throws on auth failure, network error, or protocol error — these are adapter failures,
 * not individual bad items. One malformed message is skipped; a broken adapter is an alert.
 */
export async function poll({
  cursor = null,
  policy = {},
  clientFactory = defaultClientFactory,
  pageSize = PAGE_SIZE,
} = {}) {
  const chatsAllow = (policy && policy.chatsAllow) || [];

  // Fail closed: empty allowlist yields nothing
  if (!Array.isArray(chatsAllow) || chatsAllow.length === 0) {
    return { items: [], cursor, seen: 0, invalid: [] };
  }

  // Create client (or use injected one)
  let client;
  if (typeof clientFactory === 'object' && clientFactory.callTool) {
    // Already a client; use it directly (testing pattern)
    client = clientFactory;
  } else {
    // Factory function; call it to create a client
    client = await clientFactory({ pageSize });
  }

  // Fetch messages. Use search_messages with a limit to get recent messages.
  // If a cursor is provided, use it as the query parameter.
  let messages;
  try {
    const searchArgs = { limit: pageSize };
    if (cursor) {
      searchArgs.after = cursor;
    }
    messages = await client.callTool('search_messages', searchArgs);
  } catch (err) {
    // Auth errors, network errors, etc. are adapter failures
    throw new Error(`Beeper adapter failed: ${err.message}`);
  }

  // Ensure we got an array
  if (!Array.isArray(messages)) {
    throw new Error('Beeper search_messages did not return an array');
  }

  const items = [];
  const invalid = [];
  let newestTimestamp = null;
  let newestCursorId = null;

  for (const message of messages) {
    if (!message || typeof message !== 'object') continue;

    const chatName = message.chat_name || message.room_name || '(unknown)';
    const msgId = message.id || message.event_id;

    if (!isInteresting(message, policy)) continue;

    try {
      const envelope = toEnvelope(message, chatName);
      items.push(envelope);

      // ONLY advance cursor from successfully-created envelopes with real timestamps.
      // A message that fails envelope creation is dropped, and its timestamp (if any)
      // is never used. This prevents bad/unparseable timestamps from advancing the cursor.
      const msgTimestamp = Date.parse(envelope.ts);
      if (newestTimestamp === null || msgTimestamp > newestTimestamp) {
        newestTimestamp = msgTimestamp;
        newestCursorId = msgId;
      }
    } catch (err) {
      invalid.push({
        id: msgId || 'unknown',
        error: err.message,
      });
    }
  }

  // Oldest first, same as GitHub
  items.sort((a, b) => a.ts.localeCompare(b.ts));

  // Cursor advances only if we found valid messages. Otherwise keep the incoming cursor.
  // This ensures we never lose position if there are no new messages.
  const finalCursor = newestCursorId !== null ? newestCursorId : cursor;

  return {
    items,
    cursor: finalCursor,
    seen: messages.length,
    invalid,
  };
}
