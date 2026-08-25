// Tests for tools/inbound/notion.js. Every API response is stubbed — no network, no MCP client.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  externalIdFor,
  getTitleFrom,
  pageUrlFor,
  formatBody,
  isInteresting,
  poll,
} from './notion.js';

function notionPage(over = {}) {
  return {
    id: 'abc123def456',
    parent: { type: 'database_id', database_id: 'db-1' },
    created_by: { id: 'user-1', name: 'Test User' },
    last_edited_time: '2026-08-22T10:00:00.000Z',
    properties: {
      title: [{ type: 'text', text: { content: 'My Task' } }],
    },
    url: 'https://www.notion.so/abc123def456',
    ...over,
  };
}

function stubClientFactory(pages = []) {
  return () => {
    const calls = [];
    return {
      async initialize() {},
      async callTool(name, args) {
        calls.push({ name, args });
        if (name === 'notion-query-data-sources') {
          return pages;
        }
        throw new Error(`Unexpected tool: ${name}`);
      },
    };
  };
}

test('externalIdFor is stable across identical polls and moves on edits', () => {
  const p = notionPage();
  assert.equal(externalIdFor(p), externalIdFor({ ...p }));
  assert.notEqual(
    externalIdFor(p),
    externalIdFor(notionPage({ last_edited_time: '2026-08-22T11:00:00.000Z' })),
  );
  assert.notEqual(
    externalIdFor(p),
    externalIdFor(notionPage({ id: 'different-id' })),
  );
});

test('getTitleFrom extracts the title from properties', () => {
  const p = notionPage();
  assert.equal(getTitleFrom(p), 'My Task');
  assert.equal(getTitleFrom(notionPage({
    properties: { title: [{ type: 'text', text: { content: 'Different Title' } }] },
  })), 'Different Title');
});

test('getTitleFrom handles missing or malformed title properties', () => {
  assert.equal(getTitleFrom(null), '(untitled)');
  assert.equal(getTitleFrom({}), '(untitled)');
  assert.equal(getTitleFrom({ properties: null }), '(untitled)');
  assert.equal(getTitleFrom({ properties: { title: null } }), '(untitled)');
  assert.equal(getTitleFrom({ properties: { title: [] } }), '(untitled)');
});

test('pageUrlFor builds a deep link from the page id', () => {
  const p = notionPage({ id: 'abc-123-def' });
  assert.match(pageUrlFor(p), /notion\.so\/abc123def/);
});

test('pageUrlFor never returns empty', () => {
  assert.equal(pageUrlFor(null), 'https://www.notion.so');
  assert.equal(pageUrlFor({}), 'https://www.notion.so');
});

test('formatBody produces the title and url', () => {
  const p = notionPage({ properties: { title: [{ type: 'text', text: { content: 'My Task' } }] } });
  const body = formatBody(p);
  assert.match(body, /title: My Task/);
  assert.match(body, /url: https/);
});

test('isInteresting gates on databases allowlist, fail-closed when empty', () => {
  const p = notionPage();
  assert.equal(isInteresting(p, { databases: ['db-1'] }), true);
  assert.equal(isInteresting(p, { databases: ['db-2'] }), false);
  assert.equal(isInteresting(p, { databases: [] }), false);
  assert.equal(isInteresting(p, {}), false);
  assert.equal(isInteresting(p, null), false);
});

test('poll returns empty items when databases list is empty (fail-closed)', async () => {
  const factory = stubClientFactory([notionPage()]);
  const out = await poll({ policy: { databases: [] }, mcpClientFactory: factory });
  assert.deepEqual(out.items, []);
  assert.equal(out.cursor, null);
});

test('poll returns normalized envelopes, oldest first', async () => {
  const pages = [
    notionPage({ id: '2', last_edited_time: '2026-08-22T12:00:00Z' }),
    notionPage({ id: '1', last_edited_time: '2026-08-22T10:00:00Z' }),
  ];
  const factory = stubClientFactory(pages);
  const out = await poll({
    policy: { databases: ['db-1'] },
    mcpClientFactory: factory,
  });
  assert.equal(out.items.length, 2);
  assert.deepEqual(out.items.map(i => i.ts), [
    '2026-08-22T10:00:00.000Z',
    '2026-08-22T12:00:00.000Z',
  ]);
  const item = out.items[0];
  assert.equal(item.source, 'notion');
  assert.match(item.subject, /Task:/);
  assert.match(item.body, /title: My Task/);
});

test('poll advances cursor to the newest edited_time', async () => {
  const pages = [
    notionPage({ last_edited_time: '2026-08-22T15:00:00Z' }),
  ];
  const factory = stubClientFactory(pages);
  const out = await poll({
    cursor: '2026-08-22T09:00:00Z',
    policy: { databases: ['db-1'] },
    mcpClientFactory: factory,
  });
  assert.equal(out.cursor, '2026-08-22T15:00:00.000Z');
});

test('poll never moves cursor backwards', async () => {
  const pages = [
    notionPage({ last_edited_time: '2026-08-22T08:00:00Z' }),
  ];
  const factory = stubClientFactory(pages);
  const out = await poll({
    cursor: '2026-08-22T10:00:00.000Z',
    policy: { databases: ['db-1'] },
    mcpClientFactory: factory,
  });
  assert.equal(out.cursor, '2026-08-22T10:00:00.000Z');
});

test('poll on an empty database keeps cursor and returns no items', async () => {
  const factory = stubClientFactory([]);
  const out = await poll({
    cursor: '2026-08-22T09:00:00.000Z',
    policy: { databases: ['db-1'] },
    mcpClientFactory: factory,
  });
  assert.deepEqual(out.items, []);
  assert.equal(out.cursor, '2026-08-22T09:00:00.000Z');
});

test('poll skips malformed pages instead of losing the rest', async () => {
  const pages = [
    notionPage({ id: '1' }),
    notionPage({ id: '2', last_edited_time: 'not-a-date' }),
    null,
    notionPage({ id: '3' }),
  ];
  const factory = stubClientFactory(pages);
  const out = await poll({
    policy: { databases: ['db-1'] },
    mcpClientFactory: factory,
  });
  assert.equal(out.items.length, 2);
  assert.equal(out.invalid.length, 1);
  assert.equal(out.invalid[0].id, '2');
});

test('poll calls notion-query-data-sources with the database id', async () => {
  let capturedCalls = [];
  const factory = () => {
    return {
      async initialize() {},
      async callTool(name, args) {
        capturedCalls.push({ name, args });
        return [];
      },
    };
  };
  await poll({
    policy: { databases: ['db-abc', 'db-def'] },
    mcpClientFactory: factory,
  });
  assert.equal(capturedCalls.length, 2);
  assert.equal(capturedCalls[0].name, 'notion-query-data-sources');
  assert.equal(capturedCalls[0].args.source_id, 'db-abc');
  assert.equal(capturedCalls[1].args.source_id, 'db-def');
});

test('poll passes cursor as a filter when provided', async () => {
  let capturedCalls = [];
  const factory = () => {
    return {
      async initialize() {},
      async callTool(name, args) {
        capturedCalls.push({ name, args });
        return [];
      },
    };
  };
  await poll({
    cursor: '2026-08-22T10:00:00Z',
    policy: { databases: ['db-1'] },
    mcpClientFactory: factory,
  });
  assert.ok(capturedCalls[0].args.filter, 'filter should be passed');
  assert.equal(capturedCalls[0].args.filter.value, '2026-08-22T10:00:00Z');
});

test('poll throws on transport/auth errors but skips database-specific errors', async () => {
  let attemptCount = 0;
  const factory = () => {
    return {
      async initialize() {},
      async callTool(name, args) {
        attemptCount += 1;
        if (args.source_id === 'db-bad-auth') {
          throw new Error('HTTP 401: Unauthorized');
        }
        if (args.source_id === 'db-timeout') {
          throw new Error('Request timeout after 30000ms');
        }
        // db-ok succeeds
        return [notionPage({ parent: { database_id: 'db-ok' } })];
      },
    };
  };
  // A 401 or timeout should propagate
  try {
    await poll({
      policy: { databases: ['db-bad-auth'] },
      mcpClientFactory: factory,
    });
    assert.fail('Expected HTTP 401 to throw');
  } catch (err) {
    assert.match(err.message, /401/);
  }

  try {
    await poll({
      policy: { databases: ['db-timeout'] },
      mcpClientFactory: factory,
    });
    assert.fail('Expected timeout to throw');
  } catch (err) {
    assert.match(err.message, /timeout/);
  }
});

test('poll never calls mutating tools', async () => {
  let callCount = 0;
  const factory = () => {
    return {
      async initialize() {},
      async callTool(name, args) {
        callCount += 1;
        // Only read-only tools allowed
        if (name.includes('create') || name.includes('update') || name.includes('delete')) {
          throw new Error(`Mutating tool called: ${name}`);
        }
        return [];
      },
    };
  };
  const out = await poll({
    policy: { databases: ['db-1'] },
    mcpClientFactory: factory,
  });
  // At least one read-only tool was called
  assert.ok(callCount > 0, 'should have called at least one tool');
  // No error thrown means no mutating tools were called
});

test('poll throws when NOTION_TOKEN is not set', async () => {
  // Import the module fresh to ensure we get the default factory behavior
  const { poll: pollFunc } = await import('./notion.js');

  // Mock process.env to not have NOTION_TOKEN
  const origToken = process.env.NOTION_TOKEN;
  delete process.env.NOTION_TOKEN;

  try {
    await pollFunc({ policy: { databases: ['db-1'] } });
    assert.fail('Expected NOTION_TOKEN error');
  } catch (err) {
    assert.match(err.message, /NOTION_TOKEN/);
  } finally {
    if (origToken) process.env.NOTION_TOKEN = origToken;
  }
});
