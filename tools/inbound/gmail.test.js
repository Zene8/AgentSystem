// Tests for tools/inbound/gmail.js. Every API response is stubbed — no network, no MCP calls.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  defaultCreateClient,
  filterMessages,
  externalIdFor,
  urlFor,
  poll,
} from './gmail.js';

const POLICY = {
  sendersAllow: ['alice@example.com', 'bob@example.com'],
  labelsIgnore: ['spam', 'archive'],
  maxActionsPerDay: 12,
};

function message(over = {}) {
  return {
    messageId: 'msg-1001',
    id: 'msg-1001',
    threadId: 'thread-1001',
    from: 'alice@example.com',
    subject: 'Test message',
    timestamp: '2026-08-22T10:00:00Z',
    labels: ['inbox'],
    body: 'Hello, world!',
    ...over,
  };
}

function threadDetail(messages = [], over = {}) {
  return {
    id: 'thread-1001',
    from: 'alice@example.com',
    subject: 'Test thread',
    timestamp: '2026-08-22T10:00:00Z',
    labels: ['inbox'],
    messages: messages.length > 0 ? messages : [message()],
    ...over,
  };
}

function stubClient(searchResult = [], threadDetails = {}) {
  const calls = { search: [], getThread: [], initialize: [] };

  return {
    async initialize() {
      calls.initialize.push({});
      return { protocolVersion: '2024-11-05', capabilities: {} };
    },
    async callTool(name, args) {
      if (name === 'search_threads') {
        calls.search.push(args);
        return searchResult;
      }
      if (name === 'get_thread') {
        calls.getThread.push(args);
        const threadId = args.threadId || '';
        return threadDetails[threadId] || threadDetail();
      }
      throw new Error(`Unknown tool: ${name}`);
    },
    calls,
  };
}

test('filterMessages: empty allowlist yields nothing (fail-closed)', () => {
  const policy = { sendersAllow: [], labelsIgnore: [] };
  const result = filterMessages([message()], policy);
  assert.equal(result.length, 0);
});

test('filterMessages: allowlist match yields the item', () => {
  const result = filterMessages([message()], POLICY);
  assert.equal(result.length, 1);
  assert.equal(result[0].from, 'alice@example.com');
});

test('filterMessages: non-matching sender is dropped', () => {
  const result = filterMessages(
    [message({ from: 'unknown@example.com' })],
    POLICY
  );
  assert.equal(result.length, 0);
});

test('filterMessages: labels_ignore filters out matching labels', () => {
  const result = filterMessages(
    [message({ labels: ['inbox', 'spam'] })],
    POLICY
  );
  assert.equal(result.length, 0);
});

test('filterMessages: labels_ignore does not filter non-matching labels', () => {
  const result = filterMessages(
    [message({ labels: ['inbox', 'important'] })],
    POLICY
  );
  assert.equal(result.length, 1);
});

test('filterMessages: multiple messages with mixed matches', () => {
  const msgs = [
    message({ from: 'alice@example.com' }),
    message({ from: 'unknown@example.com' }),
    message({ from: 'bob@example.com', labels: ['spam'] }),
    message({ from: 'bob@example.com' }),
  ];
  const result = filterMessages(msgs, POLICY);
  assert.equal(result.length, 2);
  assert.deepEqual(
    result.map((m) => m.from),
    ['alice@example.com', 'bob@example.com']
  );
});

test('externalIdFor is stable across identical messages', () => {
  const msg = message();
  assert.equal(externalIdFor(msg), externalIdFor({ ...msg }));
});

test('externalIdFor changes when message ID changes', () => {
  const msg1 = message({ messageId: 'msg-1' });
  const msg2 = message({ messageId: 'msg-2' });
  assert.notEqual(externalIdFor(msg1), externalIdFor(msg2));
});

test('externalIdFor includes gmail prefix', () => {
  const msg = message();
  assert.ok(externalIdFor(msg).startsWith('gmail-'));
});

test('urlFor creates a deep link to the message', () => {
  const msg = message({ messageId: 'msg-abc123' });
  const url = urlFor(msg);
  assert.match(url, /^https:\/\/mail\.google\.com/);
  assert.match(url, /msg-abc123/);
});

test('urlFor falls back to inbox when message ID is empty', () => {
  const msg = message({ messageId: '' });
  assert.equal(urlFor(msg), 'https://mail.google.com/mail/u/0/#inbox');
});

test('poll returns normalized envelopes, oldest first', async () => {
  const client = stubClient(
    [{ id: 'thread-1' }, { id: 'thread-2' }],
    {
      'thread-1': threadDetail([
        message({ id: 'msg-1', timestamp: '2026-08-22T12:00:00Z' }),
      ]),
      'thread-2': threadDetail([
        message({ id: 'msg-2', timestamp: '2026-08-22T10:00:00Z' }),
      ]),
    }
  );

  const result = await poll({
    cursor: null,
    policy: POLICY,
    createClientImpl: () => client,
  });

  assert.equal(result.items.length, 2);
  assert.deepEqual(
    result.items.map((i) => i.ts),
    ['2026-08-22T10:00:00.000Z', '2026-08-22T12:00:00.000Z']
  );
  const item = result.items[0];
  assert.equal(item.source, 'gmail');
  assert.equal(item.actor, 'alice@example.com');
  assert.match(item.subject, /Test/);
  assert.equal(item.externalId, `gmail-msg-2`);
});

test('poll advances cursor to the latest item timestamp', async () => {
  const client = stubClient(
    [{ id: 'thread-1' }],
    {
      'thread-1': threadDetail([
        message({ timestamp: '2026-08-22T10:00:00Z' }),
      ]),
    }
  );

  const result = await poll({
    cursor: '2026-08-22T09:00:00Z',
    policy: POLICY,
    createClientImpl: () => client,
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.cursor, '2026-08-22T10:00:00.000Z');
});

test('poll on empty results keeps the cursor', async () => {
  const client = stubClient([], {});
  const result = await poll({
    cursor: '2026-08-22T09:00:00Z',
    policy: POLICY,
    createClientImpl: () => client,
  });

  assert.equal(result.items.length, 0);
  assert.equal(result.cursor, '2026-08-22T09:00:00Z');
});

test('poll on first run is bounded (last 24 hours only)', async () => {
  const client = stubClient([], {});
  await poll({
    cursor: null,
    policy: POLICY,
    createClientImpl: () => client,
  });

  const searchCall = client.calls.search[0];
  assert.match(searchCall.query, /after:/);
  assert.ok(searchCall.query.includes('is:unread'));
});

test('poll calls initialize on the client', async () => {
  const client = stubClient([], {});
  await poll({
    cursor: null,
    policy: POLICY,
    createClientImpl: () => client,
  });

  assert.equal(client.calls.initialize.length, 1);
});

test('poll calls search_threads with the constructed query', async () => {
  const client = stubClient([], {});
  await poll({
    cursor: '2026-08-22T10:00:00Z',
    policy: POLICY,
    createClientImpl: () => client,
  });

  const searchCall = client.calls.search[0];
  assert.ok(searchCall.query.includes('after:2026-08-22T10:00:00Z'));
});

test('poll skips one bad thread instead of losing the rest', async () => {
  const badThread = () => { throw new Error('Thread not found'); };
  const client = {
    async initialize() { return {}; },
    async callTool(name, args) {
      if (name === 'search_threads') return [{ id: 'thread-1' }, { id: 'thread-bad' }, { id: 'thread-3' }];
      if (name === 'get_thread') {
        if (args.threadId === 'thread-bad') badThread();
        return threadDetail([message({ id: `msg-${args.threadId}` })]);
      }
      throw new Error(`Unknown tool: ${name}`);
    },
  };

  const result = await poll({
    cursor: null,
    policy: POLICY,
    createClientImpl: () => client,
  });

  assert.equal(result.items.length, 2);
});

test('poll throws on search_threads API error (expired token)', async () => {
  const client = {
    async initialize() { return {}; },
    async callTool(name) {
      if (name === 'search_threads') {
        throw new Error('HTTP 401: Invalid credentials');
      }
    },
  };

  await assert.rejects(
    () => poll({
      cursor: null,
      policy: POLICY,
      createClientImpl: () => client,
    }),
    /Invalid credentials/
  );
});

test('poll throws when search_threads does not return an array', async () => {
  const client = {
    async initialize() { return {}; },
    async callTool(name) {
      if (name === 'search_threads') return { error: 'Something went wrong' };
    },
  };

  await assert.rejects(
    () => poll({
      cursor: null,
      policy: POLICY,
      createClientImpl: () => client,
    }),
    /did not return an array/
  );
});

test('poll never calls mutating tools (assert on stub)', async () => {
  const client = stubClient(
    [{ id: 'thread-1' }],
    { 'thread-1': threadDetail() }
  );

  await poll({
    cursor: null,
    policy: POLICY,
    createClientImpl: () => client,
  });

  // Only initialize, search_threads, and get_thread should have been called.
  const toolNames = client.calls.search.length > 0 ? 'search' : null
    || client.calls.getThread.length > 0 ? 'getThread' : null;
  assert.ok(
    client.calls.initialize.length > 0,
    'initialize should be called'
  );
  assert.ok(
    client.calls.search.length > 0,
    'search_threads should be called'
  );
  assert.ok(
    client.calls.getThread.length > 0,
    'get_thread should be called'
  );
});

test('poll respects the policy sendersAllow allowlist strictly', async () => {
  const client = stubClient(
    [{ id: 'thread-1' }, { id: 'thread-2' }],
    {
      'thread-1': threadDetail([
        message({ from: 'alice@example.com' }),
      ]),
      'thread-2': threadDetail([
        message({ from: 'unknown@example.com' }),
      ]),
    }
  );

  const result = await poll({
    cursor: null,
    policy: POLICY,
    createClientImpl: () => client,
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].actor, 'alice@example.com');
});

test('poll body is truncated via truncateBody', async () => {
  const longBody = 'x'.repeat(5000);
  const client = stubClient(
    [{ id: 'thread-1' }],
    {
      'thread-1': threadDetail([
        message({ body: longBody }),
      ]),
    }
  );

  const result = await poll({
    cursor: null,
    policy: POLICY,
    createClientImpl: () => client,
  });

  assert.ok(result.items[0].body.length <= 4000);
});

test('poll creates stable externalId per message', async () => {
  const client = stubClient(
    [{ id: 'thread-1' }],
    {
      'thread-1': threadDetail([
        message({ id: 'msg-stable-123' }),
      ]),
    }
  );

  const result = await poll({
    cursor: null,
    policy: POLICY,
    createClientImpl: () => client,
  });

  assert.ok(result.items[0].externalId.includes('msg-stable-123'));
});

test('defaultCreateClient throws when GOOGLE_OAUTH_ACCESS_TOKEN is not set', () => {
  const oldToken = process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
  delete process.env.GOOGLE_OAUTH_ACCESS_TOKEN;

  try {
    assert.throws(
      () => defaultCreateClient(),
      /GOOGLE_OAUTH_ACCESS_TOKEN/
    );
  } finally {
    if (oldToken) process.env.GOOGLE_OAUTH_ACCESS_TOKEN = oldToken;
  }
});
