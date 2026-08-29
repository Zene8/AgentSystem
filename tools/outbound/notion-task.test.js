// Tests for tools/outbound/notion-task.js. All API calls are stubbed — no network, no MCP client.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createTask } from './notion-task.js';

function stubClientFactory(response = { id: 'abc123', url: 'https://www.notion.so/abc123' }) {
  return () => {
    const calls = [];
    return {
      async initialize() {},
      async callTool(name, args) {
        calls.push({ name, args });
        if (name === 'notion-create-pages') {
          if (response instanceof Error) throw response;
          return response;
        }
        throw new Error(`Unexpected tool: ${name}`);
      },
    };
  };
}

test('createTask creates a page with title and database id', async () => {
  const factory = stubClientFactory({ id: 'page123' });
  const result = await createTask({
    title: 'My Task',
    databaseId: 'db-abc',
    mcpClientFactory: factory,
  });

  assert.ok(result.url, 'should return a url');
  assert.ok(result.url.includes('notion.so'), 'url should be a Notion page link');
  assert.equal(result.pageId, 'page123');
});

test('createTask requires title', async () => {
  const factory = stubClientFactory();
  try {
    await createTask({ databaseId: 'db-abc', mcpClientFactory: factory });
    assert.fail('Expected error for missing title');
  } catch (err) {
    assert.match(err.message, /title is required/);
  }
});

test('createTask requires databaseId', async () => {
  const factory = stubClientFactory();
  try {
    await createTask({ title: 'My Task', mcpClientFactory: factory });
    assert.fail('Expected error for missing databaseId');
  } catch (err) {
    assert.match(err.message, /databaseId is required/);
  }
});

test('createTask calls notion-create-pages with correct structure', async () => {
  let capturedCall = null;
  const factory = () => {
    return {
      async initialize() {},
      async callTool(name, args) {
        capturedCall = { name, args };
        return { id: 'test-page' };
      },
    };
  };

  await createTask({
    title: 'Test Title',
    databaseId: 'db-123',
    mcpClientFactory: factory,
  });

  assert.equal(capturedCall.name, 'notion-create-pages');
  assert.ok(capturedCall.args.properties, 'should have properties');
  assert.ok(capturedCall.args.properties.title, 'should have title property');
  assert.ok(capturedCall.args.parent, 'should have parent');
  assert.equal(capturedCall.args.parent.database_id, 'db-123');
});

test('createTask in dry-run mode returns pageData without url/pageId', async () => {
  const factory = stubClientFactory();
  const result = await createTask({
    title: 'My Task',
    databaseId: 'db-abc',
    mcpClientFactory: factory,
    dryRun: true,
  });

  assert.equal(result.dryRun, true);
  assert.ok(result.pageData, 'should include pageData in dry-run');
  assert.equal(result.url, undefined, 'dryRun should not set url');
  assert.equal(result.pageId, undefined, 'dryRun should not set pageId');
});

test('createTask propagates API errors', async () => {
  const factory = stubClientFactory(new Error('notion-create-pages: 401 Unauthorized'));
  try {
    await createTask({
      title: 'My Task',
      databaseId: 'db-abc',
      mcpClientFactory: factory,
    });
    assert.fail('Expected error to propagate');
  } catch (err) {
    assert.match(err.message, /Failed to create Notion task/);
    assert.match(err.message, /401 Unauthorized/);
  }
});

test('createTask throws when API does not return page id', async () => {
  const factory = stubClientFactory({ /* no id */ });
  try {
    await createTask({
      title: 'My Task',
      databaseId: 'db-abc',
      mcpClientFactory: factory,
    });
    assert.fail('Expected error for missing page id');
  } catch (err) {
    assert.match(err.message, /did not return a page id/);
  }
});

test('createTask throws when NOTION_TOKEN is not set', async () => {
  const origToken = process.env.NOTION_TOKEN;
  delete process.env.NOTION_TOKEN;

  try {
    await createTask({ title: 'Test', databaseId: 'db-123' });
    assert.fail('Expected NOTION_TOKEN error');
  } catch (err) {
    assert.match(err.message, /NOTION_TOKEN/);
  } finally {
    if (origToken) process.env.NOTION_TOKEN = origToken;
  }
});

test('createTask never calls mutating tools other than notion-create-pages', async () => {
  const factory = () => {
    return {
      async initialize() {},
      async callTool(name, args) {
        // Only notion-create-pages is allowed; fail on any others
        if (name !== 'notion-create-pages') {
          throw new Error(`Unexpected tool (non-create): ${name}`);
        }
        return { id: 'test' };
      },
    };
  };

  // Should succeed without trying other tools
  const result = await createTask({
    title: 'Test',
    databaseId: 'db-123',
    mcpClientFactory: factory,
  });
  assert.ok(result.url);
});

test('createTask accepts optional moreProps', async () => {
  let capturedCall = null;
  const factory = () => {
    return {
      async initialize() {},
      async callTool(name, args) {
        capturedCall = { name, args };
        return { id: 'test-page' };
      },
    };
  };

  await createTask({
    title: 'Test Title',
    databaseId: 'db-123',
    moreProps: { custom_field: 'value', status: 'In Progress' },
    mcpClientFactory: factory,
  });

  assert.ok(capturedCall.args.properties.custom_field, 'should include custom_field in moreProps');
  assert.equal(capturedCall.args.properties.custom_field, 'value');
  assert.equal(capturedCall.args.properties.status, 'In Progress');
});

test('createTask builds correct Notion URL from page id', async () => {
  const factory = stubClientFactory({ id: 'abc-123-def' });
  const result = await createTask({
    title: 'Test',
    databaseId: 'db-123',
    mcpClientFactory: factory,
  });

  // Notion removes hyphens from page IDs in URLs
  assert.match(result.url, /abc123def/);
});
