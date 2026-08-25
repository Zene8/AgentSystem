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
 */
export function isAllowed(chatName, chatsAllow = []) {
  if (!Array.isArray(chatsAllow) || chatsAllow.length === 0) {
    return false;
  }
  return chatsAllow.includes(chatName);
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

  // Get the chat name with fallback to room_name
  const chatName = message.chat_name || message.room_name;

  // Empty allowlist is fail-closed
  if (!isAllowed(chatName, chatsAllow)) {
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

function toEnvelope(message, chatName) {
  const sender = message.sender || message.author || '(unknown)';
  const body = message.body || (message.content && message.content.body) || '';
  const subject = `[${chatName}] ${sender}`;

  // Handle timestamp: prefer ISO string, fall back to millisecond timestamp, then current time
  let ts = message.timestamp;
  if (!ts && message.origin_server_ts) {
    // origin_server_ts is in milliseconds; convert to ISO string
    const numMs = typeof message.origin_server_ts === 'number'
      ? message.origin_server_ts
      : Number(message.origin_server_ts);
    if (!Number.isNaN(numMs)) {
      ts = new Date(numMs).toISOString();
    }
  }
  if (!ts) ts = new Date().toISOString();

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
  let newestTimestamp = cursor ? Date.parse(cursor) || 0 : 0;
  let newestCursorId = cursor;

  for (const message of messages) {
    if (!message || typeof message !== 'object') continue;

    const chatName = message.chat_name || message.room_name || '(unknown)';
    const msgId = message.id || message.event_id;

    // Track the newest timestamp and its associated ID
    let msgTimestamp = 0;
    if (message.timestamp) {
      msgTimestamp = Date.parse(message.timestamp) || 0;
    } else if (message.origin_server_ts) {
      // origin_server_ts is in milliseconds
      const numMs = typeof message.origin_server_ts === 'number'
        ? message.origin_server_ts
        : Number(message.origin_server_ts);
      msgTimestamp = Number.isNaN(numMs) ? 0 : numMs;
    }

    if (msgTimestamp > newestTimestamp) {
      newestTimestamp = msgTimestamp;
      newestCursorId = msgId;
    }

    if (!isInteresting(message, policy)) continue;

    try {
      items.push(toEnvelope(message, chatName));
    } catch (err) {
      invalid.push({
        id: msgId || 'unknown',
        error: err.message,
      });
    }
  }

  // Oldest first, same as GitHub
  items.sort((a, b) => a.ts.localeCompare(b.ts));

  return {
    items,
    cursor: newestCursorId,
    seen: messages.length,
    invalid,
  };
}
