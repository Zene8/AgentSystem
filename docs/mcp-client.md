# MCP Client — Universal Headless Client

**Location:** `tools/mcp-client.js`  
**Status:** Foundation for issue #483 phases 4 & 5  
**Test coverage:** 33 tests, 100% pass rate

## Overview

A universal, transport-agnostic client for speaking JSON-RPC 2.0 over HTTP to MCP (Model Context Protocol) endpoints. Built as the foundation for inbound adapters (Gmail, Beeper, Notion) that run in cron jobs outside of interactive Claude sessions.

## Contract

### Public API

```javascript
import { createClient } from './mcp-client.js';

const client = createClient({
  url: 'https://mcp.server.com/v1/mcp',
  token: 'bearer-token-value',           // optional; see auth below
  fetchImpl: globalThis.fetch,            // optional; for testing
  timeoutMs: 30000,                      // optional; default 30s
});

// Initialize the session (captures Mcp-Session-Id header)
await client.initialize();

// List available tools
const tools = await client.listTools();

// Call a tool
const result = await client.callTool('tool_name', { arg: 'value' });
```

### Response Handling

The client automatically handles both response formats:

1. **Plain JSON:** A single JSON-RPC 2.0 response body
2. **SSE-framed:** `text/event-stream` with `data:` lines (for streaming servers)

For `tools/call`, the result is:
- **Text extraction:** If the result is an array of content blocks with `type: 'text'`, text is extracted and concatenated
- **Structured fallback:** If the result is an object or already structured, returned as-is
- **Empty fallback:** If no content, returns `''`

### Error Handling

All errors are thrown with descriptive messages (never including tokens):

| Condition | Error | Thrown |
|-----------|-------|--------|
| Missing or invalid URL | `MCP client: url is required` | At client creation |
| Invalid URL scheme | `MCP client: url must be http(s):` | At client creation |
| HTTP error (non-2xx) | `HTTP 401: Unauthorized` | During request |
| JSON-RPC error member | `JSON-RPC error: <server message>` | During request |
| Tool returns `isError: true` | `Tool error (tool_name): <message>` | During `callTool()` |
| Request timeout | `Request timeout after 30000ms` | During any call |
| Missing credential | `MCP adapter: ENV_VAR_NAME environment variable is not set` | When helper called |

### Session Management

The client automatically:
- Extracts and stores the `Mcp-Session-Id` response header from the first request
- Echoes the session ID on all subsequent requests in the `Mcp-Session-Id` header
- Never re-initializes the session

## Per-Server Credential Requirements

Auth is explicit: the caller supplies a bearer token. The client does **not** read or reuse Claude Code's interactive credential store (`~/.claude/.credentials.json` or OS keychain).

### Token Validation

**The client does NOT enforce token presence.** If a server requires auth and no token is supplied, the client sends an unauthenticated request and the server returns HTTP 401.

**Callers must validate tokens explicitly** using the exported `validateToken()` helper before constructing a client:

```javascript
import { createClient, validateToken } from './mcp-client.js';

const token = process.env.NOTION_TOKEN;
validateToken(token, 'NOTION_TOKEN');  // Throws if token is missing or empty

const client = createClient({
  url: 'https://mcp.notion.com/mcp',
  token,
});
```

This is a **design choice**: a client on the tailnet may connect to an unauthenticated Beeper endpoint, and the HTTP 401 is the appropriate feedback. Adapters that require auth must call `validateToken()` themselves.

### Notion

**Environment variable:** `NOTION_TOKEN`  
**Server endpoint:** `https://mcp.notion.com/mcp` (or local dev server)  
**Token format:** Notion API bearer token (starts with `secret_` or `ntn_`)

```javascript
const client = createClient({
  url: process.env.NOTION_MCP_URL || 'https://mcp.notion.com/mcp',
  token: process.env.NOTION_TOKEN,
});
if (!client) throw new Error('NOTION_TOKEN is not set');
```

### Beeper

**Environment variable:** `BEEPER_ACCESS_TOKEN`  
**Server endpoint:** `http://localhost:23373/v0/mcp` (or Beeper cloud endpoint)  
**Token format:** Beeper API access token

### Gmail

**Environment variable:** `GMAIL_ACCESS_TOKEN`  
**Server endpoint:** Configured in Claude Code `settings.json` mcpServers  
**Token format:** OAuth 2.0 access token  
**Note:** Does NOT use Claude Code's interactive credentials; the adapter must obtain its own token

### GitHub

**No new auth required.** Uses existing `gh` CLI, which is already installed and authenticated on all AgentSystem hosts.

## Testing

Tests run against stubbed responses with zero network. Every test provides:
- A mock `fetchImpl` function that implements the Response API shape
- Verification that bearer tokens are sent (but never logged)
- Both plain JSON and SSE response handling
- Error conditions and timeouts
- Session ID capture and echo

Run tests:
```bash
node --test tools/mcp-client.test.js
npm test  # Full suite
```

## Implementation Details

### Transport Injection

The `fetchImpl` parameter is **required** for testability. Tests pass a mock function; production uses `globalThis.fetch`.

```javascript
const mockFetch = async (url, options) => {
  // Return a Response-like object with:
  // - ok, status, statusText
  // - headers.get(name)
  // - text() -> Promise<string>
  // - arrayBuffer() -> Promise<Uint8Array>
};
```

### Timeout Handling

Per-call timeouts use `AbortController`. Default is 30 seconds. If a request exceeds the timeout, the `AbortController` aborts and throws `Request timeout after ${timeoutMs}ms`.

### Response Size Limits

Responses are capped at 16 MiB to prevent OOM attacks. A response larger than this throws `Response too large: <bytes> > 16777216 bytes`.

### SSE Frame Parsing

Multi-line JSON in SSE responses is reconstructed by:
1. Collecting lines prefixed with `data: `
2. Concatenating them until a `data: [DONE]` marker or the next frame
3. Parsing the result as one JSON-RPC response

## Integration Examples

### Inbound Adapter

```javascript
import { createClient, validateToken } from './mcp-client.js';

export async function poll({ cursor = null, token } = {}) {
  validateToken(token, 'NOTION_TOKEN');
  
  const client = createClient({
    url: 'https://mcp.notion.com/mcp',
    token,
  });

  await client.initialize();
  
  // Adapter logic: call tools, fetch data, return normalized envelopes
  const databases = await client.callTool('list_databases', {});
  // ... normalize to envelope shape ...
}
```

### Credential Retrieval

Adapters must obtain tokens through their own channels (env vars, Beeper Cloud API, etc.). Do **not** ask the client to retrieve them:

```javascript
// ✅ Correct: adapter owns auth
const token = process.env.BEEPER_ACCESS_TOKEN;
if (!token) throw new Error('BEEPER_ACCESS_TOKEN not set');

// ❌ Wrong: client does not do this
// const credentials = readCredentialsFromClaudeStore();  // NO
```

## Live Smoke Check

An opt-in command-line probe tests the client against a real MCP endpoint. Skipped by default so the full test suite stays network-free.

**Usage:**
```bash
export MCP_TOKEN=your-token-here  # Set the credential env var
node tools/mcp-client.js --probe https://mcp.server.com/v1/mcp
```

**What it does:**
1. Initializes the session (handshake)
2. Lists available tools
3. Prints tool count and names
4. Exits 0 on success, 1 on failure

**Example output:**
```
Initializing...
Listing tools...
Found 12 tool(s)
  1. read_database
  2. query_database
  3. create_page
  ...
✓ Smoke check passed
```

**To test a live server:**
```bash
# Notion
export MCP_TOKEN=secret_your-notion-token-here
node tools/mcp-client.js --probe https://mcp.notion.com/mcp

# Beeper (local)
unset MCP_TOKEN  # Beeper endpoint on tailnet may not require auth
node tools/mcp-client.js --probe http://100.82.195.75:23373/v0/mcp
```

This is the one place the client speaks to a real endpoint — integration proof before adapters run in production.

## Related Specs

- **Design:** `docs/superpowers/specs/2026-08-22-inbound-event-triage-design.md`
- **Envelope:** `tools/inbound/envelope.js`
- **GitHub adapter pattern:** `tools/inbound/github.js`
- **Phase 2 (GitHub):** Foundation for understanding the full poller + dispatcher + event bus path
- **Phase 4/5:** Email, chat, and Notion adapters built on top of this client
