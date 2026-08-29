// Tests for tools/inbound/beeper.js. Every API response is stubbed — no network, no auth.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PAGE_SIZE,
  isAllowed,
  externalIdFor,
  urlFor,
  isInteresting,
  poll,
} from './beeper.js';

const POLICY = {
  chatsAllow: ['room_general', 'id:room_alerts'],
};

function message(over = {}) {
  return {
    id: 'evt_001',
    sender: 'alice@beeper.com',
    chat_id: 'room_general',
    chat_name: '#general',
    body: 'Hello world',
    timestamp: '2026-08-22T10:00:00Z',
    ...over,
  };
}

function stubClient(messages) {
  const calls = [];
  const client = {
    callTool: (name, args) => {
      calls.push({ name, args });
      if (name === 'search_messages') {
        return Promise.resolve(messages);
      }
      throw new Error(`Unexpected tool: ${name}`);
    },
  };
  return { client, calls };
}

test('isAllowed: empty allowlist is fail-closed', () => {
  assert.equal(isAllowed('room_general', '#general', []), false);
  assert.equal(isAllowed('room_general', '#general', null), false);
  assert.equal(isAllowed('room_general', '#general', undefined), false);
});

test('isAllowed: bare entries match on stable chat ID (not spoofable)', () => {
  assert.equal(isAllowed('room_general', '#general', ['room_general']), true);
  assert.equal(isAllowed('room_alerts', '#alerts', ['room_alerts']), true);
  assert.equal(isAllowed('room_unknown', '#general', ['room_general']), false);
  // Name alone does not match bare entries
  assert.equal(isAllowed('room_other', '#general', ['room_general']), false);
});

test('isAllowed: id: prefix is explicit ID matching', () => {
  assert.equal(isAllowed('room_general', '#general', ['id:room_general']), true);
  assert.equal(isAllowed('room_unknown', '#general', ['id:room_general']), false);
});

test('isAllowed: name: prefix matches display name but is spoofable', () => {
  // A third party can rename a chat to match a name: entry
  assert.equal(isAllowed('room_other', '#general', ['name:#general']), true);
  assert.equal(isAllowed('room_other', '#changed', ['name:#general']), false);
});

test('isAllowed: entries can be mixed (bare IDs + name: entries)', () => {
  const mixed = ['room_general', 'name:#family', 'id:room_special'];
  assert.equal(isAllowed('room_general', '#anything', mixed), true);
  assert.equal(isAllowed('room_other', '#family', mixed), true);
  assert.equal(isAllowed('room_special', '#anything', mixed), true);
  assert.equal(isAllowed('room_unknown', '#unknown', mixed), false);
});

test('externalIdFor creates stable IDs from message.id', () => {
  const m = message();
  assert.equal(externalIdFor(m), externalIdFor({ ...m }));
  assert.match(externalIdFor(m), /^beeper-/);
});

test('externalIdFor falls back to event_id', () => {
  const m = { event_id: '$event123', sender: 'alice', chat_name: '#general' };
  assert.match(externalIdFor(m), /^beeper-\$event123$/);
});

test('externalIdFor handles missing ID gracefully', () => {
  const m = { sender: 'alice', chat_name: '#general' };
  assert.match(externalIdFor(m), /^beeper-unknown$/);
});

test('urlFor prefers message.url when present', () => {
  const m = message({ url: 'https://app.beeper.com/room/123' });
  assert.equal(urlFor(m, '#general'), 'https://app.beeper.com/room/123');
});

test('urlFor creates a deep link fallback from chat name', () => {
  const m = message({ url: undefined });
  assert.equal(urlFor(m, '#general'), 'https://app.beeper.com/chat/%23general');
});

test('urlFor encodes special characters in chat name', () => {
  const url = urlFor(message({ url: undefined }), '#alert-prod');
  assert.match(url, /chat\/%23alert-prod/);
});

test('urlFor returns app root when no chat name available', () => {
  const m = message({ url: undefined });
  assert.equal(urlFor(m, null), 'https://app.beeper.com');
});

test('isInteresting gates on allowlist, which is fail-closed when empty', () => {
  assert.equal(isInteresting(message(), POLICY), true);
  assert.equal(isInteresting(message({ chat_id: 'room_random', chat_name: '#random' }), POLICY), false);
  assert.equal(isInteresting(message(), { chatsAllow: [] }), false);
  assert.equal(isInteresting(message(), {}), false);
});

test('isInteresting skips non-message types (reactions, redactions, etc.)', () => {
  assert.equal(isInteresting(message({ type: 'm.reaction' }), POLICY), false);
  assert.equal(isInteresting(message({ type: 'm.room.encrypted' }), POLICY), false);
  // Only m.room.message.* types pass
  assert.equal(isInteresting(message({ type: 'm.room.message.text' }), POLICY), true);
});

test('isInteresting skips messages with no body', () => {
  assert.equal(isInteresting(message({ body: '' }), POLICY), false);
  assert.equal(isInteresting(message({ body: null }), POLICY), false);
});

test('poll returns normalized envelopes, oldest first', async () => {
  const { client } = stubClient([
    message({ id: 'evt_2', timestamp: '2026-08-22T12:00:00Z' }),
    message({ id: 'evt_1', timestamp: '2026-08-22T10:00:00Z' }),
  ]);

  const out = await poll({ cursor: null, policy: POLICY, clientFactory: client });

  assert.equal(out.items.length, 2);
  assert.deepEqual(out.items.map(i => i.ts), [
    '2026-08-22T10:00:00.000Z',
    '2026-08-22T12:00:00.000Z',
  ]);

  const item = out.items[0];
  assert.equal(item.source, 'beeper');
  assert.equal(item.actor, 'alice@beeper.com');
  assert.match(item.subject, /^\[#general\]/);
  assert.match(item.body, /Hello world/);
});

test('poll respects the allowlist and filters out non-allowed chats', async () => {
  const { client } = stubClient([
    message({ id: 'evt_1', chat_id: 'room_general', chat_name: '#general' }),
    message({ id: 'evt_2', chat_id: 'room_random', chat_name: '#random', body: 'Should be filtered' }),
    message({ id: 'evt_3', chat_id: 'room_alerts', chat_name: '#alerts' }),
  ]);

  const out = await poll({ cursor: null, policy: POLICY, clientFactory: client });

  assert.equal(out.items.length, 2);
  assert.equal(out.items[0].actor, 'alice@beeper.com');
  assert.match(out.items[0].subject, /#general/);
  assert.match(out.items[1].subject, /#alerts/);
});

test('poll returns empty items when allowlist is empty (fail-closed)', async () => {
  const out = await poll({
    cursor: null,
    policy: { chatsAllow: [] },
    clientFactory: () => { throw new Error('Should not be called'); },
  });

  assert.deepEqual(out.items, []);
  assert.equal(out.cursor, null);
  assert.equal(out.seen, 0);
});

test('poll advances the cursor to the newest message ID seen', async () => {
  const { client } = stubClient([
    message({ id: 'evt_2', timestamp: '2026-08-22T15:00:00Z' }),
    message({ id: 'evt_1', timestamp: '2026-08-22T10:00:00Z' }),
  ]);

  const out = await poll({ cursor: null, policy: POLICY, clientFactory: client });

  assert.equal(out.cursor, 'evt_2');
  assert.equal(out.seen, 2);
});

test('poll respects provided cursor', async () => {
  const { client, calls } = stubClient([message()]);

  await poll({
    cursor: 'evt_previous',
    policy: POLICY,
    clientFactory: client,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'search_messages');
  assert.equal(calls[0].args.after, 'evt_previous');
});

test('poll on an empty page keeps the cursor', async () => {
  const { client } = stubClient([]);

  const out = await poll({
    cursor: 'evt_last',
    policy: POLICY,
    clientFactory: client,
  });

  assert.deepEqual(out.items, []);
  assert.equal(out.cursor, 'evt_last');
  assert.equal(out.seen, 0);
});

test('poll skips malformed messages instead of losing the rest', async () => {
  const { client } = stubClient([
    message({ id: 'evt_1' }),
    message({ id: 'evt_2', timestamp: 'not-a-date' }),
    null,
    message({ id: 'evt_3' }),
  ]);

  const out = await poll({ cursor: null, policy: POLICY, clientFactory: client });

  assert.equal(out.items.length, 2);
  assert.equal(out.invalid.length, 1);
  assert.equal(out.invalid[0].id, 'evt_2');
});

test('poll truncates long message bodies to 4000 chars', async () => {
  const { client } = stubClient([
    message({ id: 'evt_1', body: 'x'.repeat(9000) }),
  ]);

  const out = await poll({ cursor: null, policy: POLICY, clientFactory: client });

  assert.ok(out.items[0].body.length <= 4000);
});

test('poll uses fallback timestamp when message.timestamp is missing', async () => {
  const { client } = stubClient([
    message({ id: 'evt_1', chat_id: 'room_general', timestamp: null, origin_server_ts: 1692700800000 }),
  ]);

  const out = await poll({ cursor: null, policy: POLICY, clientFactory: client });

  assert.equal(out.items.length, 1);
  // Should have parsed the origin_server_ts
  assert.ok(out.items[0].ts);
});

test('poll with unparseable timestamp message does not advance cursor past real one', async () => {
  const { client } = stubClient([
    message({ id: 'evt_1', chat_id: 'room_general', timestamp: '2026-08-22T10:00:00Z' }),
    message({ id: 'evt_2', chat_id: 'room_general', timestamp: 'not-a-date' }),
    message({ id: 'evt_3', chat_id: 'room_general', timestamp: '2026-08-22T12:00:00Z' }),
  ]);

  const out = await poll({ cursor: null, policy: POLICY, clientFactory: client });

  // evt_2 should be in invalid (unparseable timestamp)
  assert.equal(out.items.length, 2);
  assert.equal(out.invalid.length, 1);
  assert.equal(out.invalid[0].id, 'evt_2');
  // Cursor should be evt_3 (the newest real timestamp)
  assert.equal(out.cursor, 'evt_3');
});

test('poll cursor stays same when no valid messages are found', async () => {
  const { client } = stubClient([
    // All messages are filtered out by allowlist or other gates
  ]);

  const out = await poll({
    cursor: 'evt_preserved',
    policy: POLICY,
    clientFactory: client,
  });

  // Cursor should not advance if no messages pass the filters
  assert.equal(out.cursor, 'evt_preserved');
  assert.equal(out.items.length, 0);
});

test('poll throws on auth failure (expired token scenario)', async () => {
  const failingClient = {
    callTool: () => Promise.reject(new Error('HTTP 401: Unauthorized')),
  };

  await assert.rejects(
    () => poll({ cursor: null, policy: POLICY, clientFactory: failingClient }),
    /Beeper adapter failed/,
  );
});

test('poll throws when search_messages does not return an array', async () => {
  const badClient = {
    callTool: () => Promise.resolve({ error: 'not an array' }),
  };

  await assert.rejects(
    () => poll({ cursor: null, policy: POLICY, clientFactory: badClient }),
    /did not return an array/,
  );
});

test('poll never calls mutating tools (send_message, archive_chat, etc.)', async () => {
  const { client, calls } = stubClient([message()]);

  await poll({ cursor: null, policy: POLICY, clientFactory: client });

  for (const call of calls) {
    assert.ok(
      ['search_messages', 'list_messages', 'get_chat', 'get_accounts'].includes(call.name),
      `Called unexpected tool: ${call.name}`,
    );
  }
});

test('poll with injected fetchImpl (no real network)', async () => {
  // Mock fetch that records calls and returns a stubbed response
  const fetchCalls = [];
  const mockFetch = async (url, options) => {
    fetchCalls.push({ url, options: { ...options, body: '(redacted)' } });
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Map([['content-type', 'application/json']]),
      text: async () => JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        result: [message()],
      }),
      arrayBuffer: async () => new TextEncoder().encode(JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        result: [message()],
      })),
    };
  };

  // Create a client factory that uses our mock fetch
  const clientFactory = async (opts = {}) => {
    const { createClient } = await import('../mcp-client.js');
    const client = createClient({
      url: 'http://100.82.195.75:23373/v0/mcp',
      token: 'test-token',
      fetchImpl: mockFetch,
    });
    await client.initialize();
    return client;
  };

  const out = await poll({
    cursor: null,
    policy: POLICY,
    clientFactory,
  });

  assert.equal(out.items.length, 1);
  assert.ok(fetchCalls.length > 0, 'Mock fetch was called');
});

test('poll handles room_name fallback when chat_name is missing', async () => {
  const { client } = stubClient([
    message({ id: 'evt_1', chat_id: 'room_alerts', chat_name: null, room_name: '#alerts' }),
  ]);

  const out = await poll({
    cursor: null,
    policy: { chatsAllow: ['room_alerts'] },
    clientFactory: client,
  });

  assert.equal(out.items.length, 1);
  assert.match(out.items[0].subject, /#alerts/);
});

test('poll handles event_id fallback for externalId', async () => {
  const { client } = stubClient([
    message({ id: null, chat_id: 'room_general', event_id: '$matrix_event_123' }),
  ]);

  const out = await poll({ cursor: null, policy: POLICY, clientFactory: client });

  assert.equal(out.items.length, 1);
  assert.match(out.items[0].externalId, /\$matrix_event_123/);
});
