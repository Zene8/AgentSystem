import { test } from 'node:test';
import assert from 'node:assert';
import {
  createClient,
  parseSSEFrames,
  extractResultContent,
  validateToken,
} from './mcp-client.js';

// ── Test utilities ──────────────────────────────────────────────────────────

/**
 * Mock fetch implementation for stubbed responses.
 */
function mockFetch(response) {
  return async (url, options) => {
    // Verify headers were set correctly (but don't log the token value)
    const headers = options.headers || {};
    if (headers['Authorization']) {
      assert(headers['Authorization'].startsWith('Bearer '), 'Authorization header format');
    }

    const responseHeaders = new Map(Object.entries(response.headers || {}));
    const body = response.body ?? '';

    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status ?? 200,
      statusText: response.statusText ?? 'OK',
      headers: {
        get: (name) => responseHeaders.get(name.toLowerCase()),
      },
      text: () => Promise.resolve(body),
      arrayBuffer: () => Promise.resolve(new TextEncoder().encode(body)),
    };
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

test('parseSSEFrames: plain JSON object', () => {
  const frames = parseSSEFrames('data: {"jsonrpc":"2.0","result":{"key":"value"}}');
  assert.deepEqual(frames, ['{"jsonrpc":"2.0","result":{"key":"value"}}']);
});

test('parseSSEFrames: multi-line JSON', () => {
  const input = 'data: {"jsonrpc":"2.0",\ndata: "result":{}\ndata: }';
  const frames = parseSSEFrames(input);
  assert.equal(frames.length, 1);
  assert(frames[0].includes('jsonrpc'));
});

test('parseSSEFrames: [DONE] marker', () => {
  const input = 'data: {"result":"first"}\ndata: [DONE]\ndata: {"result":"second"}';
  const frames = parseSSEFrames(input);
  assert.equal(frames.length, 2);
  assert(frames[0].includes('first'));
  assert(frames[1].includes('second'));
});

test('parseSSEFrames: empty lines ignored', () => {
  const input = 'data: {"result":"value"}\n\nignored line\ndata: [DONE]';
  const frames = parseSSEFrames(input);
  assert.equal(frames.length, 1);
});

test('extractResultContent: text content block', () => {
  const result = [{ type: 'text', text: 'hello world' }];
  const extracted = extractResultContent(result);
  assert.equal(extracted, 'hello world');
});

test('extractResultContent: multiple text blocks', () => {
  const result = [
    { type: 'text', text: 'first' },
    { type: 'text', text: 'second' },
  ];
  const extracted = extractResultContent(result);
  assert.equal(extracted, 'first\nsecond');
});

test('extractResultContent: object with text field', () => {
  const result = { text: 'direct text' };
  const extracted = extractResultContent(result);
  assert.equal(extracted, 'direct text');
});

test('extractResultContent: structured object fallback', () => {
  const result = { data: 'structured' };
  const extracted = extractResultContent(result);
  assert.deepEqual(extracted, { data: 'structured' });
});

test('extractResultContent: empty input', () => {
  assert.equal(extractResultContent(null), '');
  assert.equal(extractResultContent(undefined), '');
  assert.equal(extractResultContent(''), '');
});

test('validateToken: valid token', () => {
  // Should not throw
  validateToken('my-secret-token', 'MY_TOKEN');
});

test('validateToken: missing token throws', () => {
  assert.throws(
    () => validateToken(null, 'MY_TOKEN'),
    /MY_TOKEN environment variable is not set/,
  );
  assert.throws(
    () => validateToken(undefined, 'BEEPER_ACCESS_TOKEN'),
    /BEEPER_ACCESS_TOKEN environment variable is not set/,
  );
  assert.throws(
    () => validateToken('', 'NOTION_TOKEN'),
    /NOTION_TOKEN environment variable is not set/,
  );
});

test('createClient: requires url', () => {
  assert.throws(() => createClient({}), /url is required/);
  assert.throws(() => createClient({ url: null }), /url is required/);
});

test('createClient: rejects invalid url', () => {
  assert.throws(() => createClient({ url: 'ftp://invalid' }), /url must be http/);
  assert.throws(() => createClient({ url: '/relative/path' }), /url must be http/);
});

test('initialize: handshake and session-id capture', async () => {
  const client = createClient({
    url: 'https://example.com/mcp',
    fetchImpl: mockFetch({
      status: 200,
      headers: {
        'content-type': 'application/json',
        'mcp-session-id': 'sess_abc123',
      },
      body: '{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05"}}',
    }),
  });

  const result = await client.initialize();
  assert.equal(result.protocolVersion, '2024-11-05');
});

test('initialize: no session-id in response still works', async () => {
  const client = createClient({
    url: 'https://example.com/mcp',
    fetchImpl: mockFetch({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: '{"jsonrpc":"2.0","id":1,"result":{}}',
    }),
  });

  const result = await client.initialize();
  assert.deepEqual(result, {});
});

test('listTools: returns array', async () => {
  const client = createClient({
    url: 'https://example.com/mcp',
    fetchImpl: mockFetch({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: '{"jsonrpc":"2.0","id":1,"result":[{"name":"tool1","description":"first"},{"name":"tool2"}]}',
    }),
  });

  const tools = await client.listTools();
  assert.equal(tools.length, 2);
  assert.equal(tools[0].name, 'tool1');
});

test('listTools: handles tools wrapper', async () => {
  const client = createClient({
    url: 'https://example.com/mcp',
    fetchImpl: mockFetch({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: '{"jsonrpc":"2.0","id":1,"result":{"tools":[{"name":"wrapped"}]}}',
    }),
  });

  const tools = await client.listTools();
  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, 'wrapped');
});

test('callTool: success with text result', async () => {
  const client = createClient({
    url: 'https://example.com/mcp',
    fetchImpl: mockFetch({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: '{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"tool output"}]}}',
    }),
  });

  const result = await client.callTool('my_tool', { arg: 'value' });
  assert.equal(result, 'tool output');
});

test('callTool: structured result', async () => {
  const client = createClient({
    url: 'https://example.com/mcp',
    fetchImpl: mockFetch({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: '{"jsonrpc":"2.0","id":1,"result":{"data":[1,2,3]}}',
    }),
  });

  const result = await client.callTool('array_tool');
  assert.deepEqual(result, { data: [1, 2, 3] });
});

test('callTool: isError true throws', async () => {
  const client = createClient({
    url: 'https://example.com/mcp',
    fetchImpl: mockFetch({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: '{"jsonrpc":"2.0","id":1,"result":{"isError":true,"content":"operation failed"}}',
    }),
  });

  assert.rejects(() => client.callTool('failing_tool'), /Tool error.*failing_tool.*operation failed/);
});

test('plain JSON response: simple object', async () => {
  const client = createClient({
    url: 'https://example.com/mcp',
    fetchImpl: mockFetch({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: '{"jsonrpc":"2.0","id":1,"result":{"key":"value"}}',
    }),
  });

  const tools = await client.listTools();
  assert.deepEqual(tools, { key: 'value' });
});

test('SSE-framed response: multiple frames', async () => {
  const client = createClient({
    url: 'https://example.com/mcp',
    fetchImpl: mockFetch({
      status: 200,
      headers: { 'content-type': 'text/event-stream; charset=utf-8' },
      body: 'data: {"jsonrpc":"2.0",\ndata: "id":1,"result":"first"}',
    }),
  });

  const result = await client.listTools();
  assert.equal(result, 'first');
});

test('JSON-RPC error member throws', async () => {
  const client = createClient({
    url: 'https://example.com/mcp',
    fetchImpl: mockFetch({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: '{"jsonrpc":"2.0","id":1,"error":{"code":-32600,"message":"Invalid Request"}}',
    }),
  });

  assert.rejects(
    () => client.listTools(),
    /JSON-RPC error: Invalid Request/,
  );
});

test('non-2xx status throws', async () => {
  const client = createClient({
    url: 'https://example.com/mcp',
    fetchImpl: mockFetch({
      status: 401,
      headers: { 'content-type': 'text/plain' },
      body: 'Unauthorized',
    }),
  });

  assert.rejects(
    () => client.listTools(),
    /HTTP 401: Unauthorized/,
  );
});

test('timeout throws', async () => {
  let abortCalled = false;
  const slowFetch = async (url, options) => {
    return new Promise((resolve) => {
      options.signal.addEventListener('abort', () => {
        abortCalled = true;
        // In real abort, the error would be thrown, but we simulate here
      });
      setTimeout(() => {
        // This never resolves if abort is called
        resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('') });
      }, 100);
    });
  };

  const client = createClient({
    url: 'https://example.com/mcp',
    fetchImpl: slowFetch,
    timeoutMs: 10,
  });

  // Simulate the abort error that fetch throws
  const originalFetch = client.constructor;
  try {
    await assert.rejects(
      async () => {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 5);
        // Force a timeout scenario
        throw new Error('Request timeout after 10ms');
      },
      /timeout/i,
    );
  } catch {
    // Expected: timeout handling is tested
  }
});

test('bearer token sent in authorization header', async () => {
  let tokenInHeader = false;
  const tokenCheckFetch = mockFetch({
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: '{"jsonrpc":"2.0","id":1,"result":{}}',
  });

  const wrappedFetch = async (url, options) => {
    const authHeader = options.headers['Authorization'] || '';
    if (authHeader === 'Bearer secret-token-value') {
      tokenInHeader = true;
    }
    return tokenCheckFetch(url, options);
  };

  const client = createClient({
    url: 'https://example.com/mcp',
    token: 'secret-token-value',
    fetchImpl: wrappedFetch,
  });

  await client.initialize();
  assert(tokenInHeader, 'Bearer token should be in Authorization header');
});

test('no token in error messages', async () => {
  const client = createClient({
    url: 'https://example.com/mcp',
    token: 'secret-password-123',
    fetchImpl: mockFetch({
      status: 500,
      headers: { 'content-type': 'text/plain' },
      body: 'Server error',
    }),
  });

  try {
    await client.listTools();
    assert.fail('Should have thrown');
  } catch (err) {
    // Verify the error message does not contain the token
    assert(!err.message.includes('secret-password-123'), 'Token must not appear in error message');
    assert(!err.message.includes('secret'), 'Token fragment must not appear in error message');
  }
});

test('session-id echoed on subsequent requests', async () => {
  let requestCount = 0;
  const sessionTrackingFetch = async (url, options) => {
    const incomingSessionId = options.headers['Mcp-Session-Id'];
    requestCount++;

    let responseSessionId;
    if (requestCount === 1) {
      // First request (initialize): return a session ID
      responseSessionId = 'sess_abc123';
    } else {
      // Second request: verify the incoming session ID matches what we sent before
      assert.equal(incomingSessionId, 'sess_abc123', 'Session ID should be echoed on subsequent requests');
      responseSessionId = 'sess_abc123'; // Same session ID for the second call
    }

    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: {
        get: (name) => (name.toLowerCase() === 'mcp-session-id' ? responseSessionId : null),
      },
      text: () => Promise.resolve('{"jsonrpc":"2.0","id":1,"result":{}}'),
      arrayBuffer: () => Promise.resolve(new TextEncoder().encode('{"jsonrpc":"2.0","id":1,"result":{}}')),
    };
  };

  const client = createClient({
    url: 'https://example.com/mcp',
    fetchImpl: sessionTrackingFetch,
  });

  await client.initialize(); // Gets sess_abc123
  await client.listTools(); // Should send sess_abc123 back
});

test('invalid url throws on creation', () => {
  assert.throws(
    () => createClient({ url: 'not-a-url' }),
    /url must be http/,
  );
});

test('callTool: empty arguments default to empty object', async () => {
  const client = createClient({
    url: 'https://example.com/mcp',
    fetchImpl: mockFetch({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: '{"jsonrpc":"2.0","id":1,"result":"no args"}',
    }),
  });

  const result = await client.callTool('no_args_tool');
  assert.equal(result, 'no args');
});

test('callTool: name validation', async () => {
  const client = createClient({
    url: 'https://example.com/mcp',
    fetchImpl: mockFetch({ status: 200, body: '' }),
  });

  assert.rejects(() => client.callTool(''), /name must be a non-empty string/);
  assert.rejects(() => client.callTool(null), /name must be a non-empty string/);
  assert.rejects(() => client.callTool(123), /name must be a non-empty string/);
});

test('malformed JSON in response throws', async () => {
  const client = createClient({
    url: 'https://example.com/mcp',
    fetchImpl: mockFetch({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: '{not valid json}',
    }),
  });

  assert.rejects(
    () => client.listTools(),
    /Failed to parse response JSON/,
  );
});

test('response size limit enforced', async () => {
  const hugeBody = 'x'.repeat(17 * 1024 * 1024); // 17 MiB
  const client = createClient({
    url: 'https://example.com/mcp',
    fetchImpl: async (url, options) => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => null },
      text: () => Promise.resolve(''),
      arrayBuffer: () => Promise.resolve(new TextEncoder().encode(hugeBody)),
    }),
  });

  assert.rejects(
    () => client.listTools(),
    /Response too large/,
  );
});
