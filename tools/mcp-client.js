// mcp-client.js — universal headless MCP client for phase 4/5 inbound adapters.
//
// Design: docs/superpowers/specs/2026-08-22-inbound-event-triage-design.md
//
// JSON-RPC 2.0 over HTTP against MCP endpoints. Implements initialize, tools/list, tools/call.
// Handles both plain JSON and SSE-framed (`text/event-stream`) response shapes.
// Transport is injected (fetchImpl) for testability — every test runs against stubs with zero network.
//
// Auth is explicit: caller supplies a bearer token via options. Do NOT read Claude Code's
// credential store. If a server needs a token and none is supplied, throw a clear error
// naming the env var the caller should set.
//
// Timeouts via AbortController (default ~30s). Non-2xx, JSON-RPC error member, or tools/call
// isError: true all throw with the server's message. Never log or include tokens in any error.

const MAX_RESPONSE_SIZE = 16 * 1024 * 1024; // 16 MiB
const DEFAULT_TIMEOUT_MS = 30000;

/**
 * Parse SSE-framed responses. Servers may return `text/event-stream` with `data:` lines.
 * Extract the complete JSON text across multiple lines if needed.
 *
 * @param {string} text - Raw response body
 * @returns {Array<string>} Array of JSON strings, one per `data:` block
 */
export function parseSSEFrames(text) {
  const frames = [];
  let currentFrame = '';

  for (const line of text.split('\n')) {
    if (line.startsWith('data: ')) {
      const data = line.slice(6); // Remove 'data: ' prefix
      if (data === '[DONE]') {
        if (currentFrame) frames.push(currentFrame);
        currentFrame = '';
      } else {
        currentFrame += data;
      }
    }
  }

  if (currentFrame) frames.push(currentFrame);
  return frames;
}

/**
 * Extract the parsed structured result from a tools/call response.
 *
 * The server may return a single top-level object, or an array of content blocks.
 * Return the parsed structured result where available, fall back to concatenated text.
 *
 * @param {any} result - The JSON-RPC result from tools/call
 * @returns {any} Parsed result or text fallback
 */
export function extractResultContent(result) {
  if (!result) return '';

  // If it's an array of content blocks, extract text
  if (Array.isArray(result)) {
    const texts = result
      .filter((block) => block && typeof block === 'object' && block.type === 'text')
      .map((block) => block.text || '')
      .filter(Boolean);
    return texts.length > 0 ? texts.join('\n') : result;
  }

  // If it's an object with a text field, return that
  if (typeof result === 'object' && typeof result.text === 'string') {
    return result.text;
  }

  // Return as-is if it's structured
  if (typeof result === 'object') {
    return result;
  }

  // Fallback to string
  return String(result);
}

/**
 * Create an MCP client for one endpoint.
 *
 * @param {Object} options
 * @param {string} options.url - MCP endpoint URL (e.g., https://mcp.notion.com/mcp)
 * @param {string} [options.token] - Bearer token for authentication
 * @param {Function} [options.fetchImpl] - Fetch implementation (default: global fetch)
 * @param {number} [options.timeoutMs] - Per-call timeout in milliseconds (default: 30000)
 * @returns {Object} Client with initialize(), listTools(), callTool(name, args) methods
 */
export function createClient({
  url,
  token,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (!url) throw new Error('MCP client: url is required');
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    throw new Error(`MCP client: url must be http(s): ${url}`);
  }

  let sessionId = null;

  /**
   * Send a JSON-RPC 2.0 request and parse the response.
   * @private
   */
  async function request(method, params = null) {
    const body = {
      jsonrpc: '2.0',
      id: 1,
      method,
    };
    if (params !== null) body.params = params;

    const headers = {
      'Content-Type': 'application/json',
    };

    if (sessionId) {
      headers['Mcp-Session-Id'] = sessionId;
    }

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutHandle);

      // Capture session ID from response headers
      const newSessionId = response.headers.get('Mcp-Session-Id');
      if (newSessionId) {
        sessionId = newSessionId;
      }

      // Non-2xx status is a server error
      if (!response.ok) {
        let detail = response.statusText;
        try {
          const text = await response.text();
          if (text) detail = text.slice(0, 500); // Limit detail size
        } catch {
          // Ignore read errors; detail stays statusText
        }
        throw new Error(`HTTP ${response.status}: ${detail}`);
      }

      let text;
      try {
        // Limit response size to prevent OOM
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength > MAX_RESPONSE_SIZE) {
          throw new Error(`Response too large: ${buffer.byteLength} > ${MAX_RESPONSE_SIZE} bytes`);
        }
        text = new TextDecoder().decode(buffer);
      } catch (err) {
        throw new Error(`Failed to read response: ${err.message}`);
      }

      // Check content type and parse accordingly
      const contentType = response.headers.get('Content-Type') || '';
      let jsonResponses;

      if (contentType.includes('text/event-stream')) {
        // SSE-framed response
        const frames = parseSSEFrames(text);
        if (frames.length === 0) {
          throw new Error('SSE response contained no data frames');
        }
        jsonResponses = frames;
      } else {
        // Plain JSON response
        jsonResponses = [text];
      }

      // Parse all JSON strings and extract the result
      const results = [];
      for (const jsonStr of jsonResponses) {
        let parsed;
        try {
          parsed = JSON.parse(jsonStr);
        } catch (err) {
          throw new Error(`Failed to parse response JSON: ${err.message}`);
        }

        // Handle JSON-RPC error
        if (parsed && typeof parsed === 'object' && parsed.error) {
          const errMsg = parsed.error.message || String(parsed.error);
          throw new Error(`JSON-RPC error: ${errMsg}`);
        }

        // Extract result
        if (parsed && typeof parsed === 'object' && 'result' in parsed) {
          results.push(parsed.result);
        }
      }

      // Return first result (most responses have one)
      return results.length > 0 ? results[0] : null;
    } catch (err) {
      clearTimeout(timeoutHandle);

      // TimeoutError or AbortError
      if (err.name === 'AbortError') {
        throw new Error(`Request timeout after ${timeoutMs}ms`);
      }

      // Re-throw with original message
      throw err;
    }
  }

  return {
    /**
     * Initialize the session (MCP handshake).
     * Sets up session ID and client metadata.
     */
    async initialize() {
      const result = await request('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
          name: 'agentsystem-inbound-client',
          version: '1.0.0',
        },
      });

      return result || {};
    },

    /**
     * List available tools on the server.
     */
    async listTools() {
      const result = await request('tools/list');
      // If result is an array, return it directly
      if (Array.isArray(result)) {
        return result;
      }
      // If result has a tools property, return that
      if (result && result.tools) {
        return result.tools;
      }
      // Otherwise return the result as-is (might be a single object or empty)
      return result || [];
    },

    /**
     * Call a tool on the server.
     *
     * @param {string} name - Tool name
     * @param {Object} args - Tool arguments
     * @returns {any} Tool result (parsed structured or text fallback)
     * @throws {Error} If tool returns isError: true or any transport/protocol error
     */
    async callTool(name, args = {}) {
      if (typeof name !== 'string' || !name) {
        throw new Error('callTool: name must be a non-empty string');
      }

      const result = await request('tools/call', {
        name,
        arguments: args,
      });

      // Check for tool-level error
      if (result && typeof result === 'object' && result.isError) {
        const errMsg = result.content ? extractResultContent(result.content) : 'Tool error';
        throw new Error(`Tool error (${name}): ${errMsg}`);
      }

      // Extract and return the result
      return result && result.content ? extractResultContent(result.content) : result;
    },
  };
}

/**
 * Validate that a token is provided and throw if missing.
 * Used by adapters to fail loudly if credentials are not configured.
 *
 * @param {string} token - The token value (may be undefined)
 * @param {string} envVarName - The environment variable name for the error message
 * @throws {Error} If token is falsy, names the env var that should be set
 */
export function validateToken(token, envVarName) {
  if (!token) {
    throw new Error(`MCP adapter: ${envVarName} environment variable is not set`);
  }
}
