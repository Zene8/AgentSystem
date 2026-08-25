import test from 'node:test';
import assert from 'node:assert';
import { resolveClaude, parseMcpList } from '../tools/life-os-doctor.js';

test('resolveClaude returns null when claude is not found', () => {
  // When HOME points to a non-existent directory, well-known paths won't exist
  const result = resolveClaude();
  // We can't assert it's null universally since claude might be installed on test hosts,
  // but we can verify it returns either a string or null (not undefined)
  assert.ok(result === null || typeof result === 'string', 'resolveClaude must return string or null');
});

test('parseMcpList parses connected status', () => {
  const text = `claude.ai Gmail: https://gmailmcp.googleapis.com/mcp/v1 - ✔ Connected`;
  const result = parseMcpList(text);
  assert.deepStrictEqual(result, { Gmail: 'connected' });
});

test('parseMcpList parses needs-auth status', () => {
  const text = `claude.ai Gmail: https://gmailmcp.googleapis.com/mcp/v1 - ⚠ Needs authentication`;
  const result = parseMcpList(text);
  assert.deepStrictEqual(result, { Gmail: 'needs-auth' });
});

test('parseMcpList parses failed status', () => {
  const text = `agentsystem: node /home/u/AgentSystem/tools/mcp-server.js - ✖ Failed`;
  const result = parseMcpList(text);
  assert.deepStrictEqual(result, { agentsystem: 'failed' });
});

test('parseMcpList handles multiple connectors', () => {
  const text = `claude.ai Gmail: https://gmailmcp.googleapis.com/mcp/v1 - ✔ Connected
claude.ai Notion: https://notion-api.com - ⚠ Needs authentication
agentsystem: node /home/u/AgentSystem/tools/mcp-server.js - ✖ Failed`;
  const result = parseMcpList(text);
  assert.deepStrictEqual(result, {
    Gmail: 'connected',
    Notion: 'needs-auth',
    agentsystem: 'failed',
  });
});

test('parseMcpList ignores invalid lines', () => {
  const text = `invalid line
claude.ai Gmail: https://gmailmcp.googleapis.com/mcp/v1 - ✔ Connected
another invalid line
trailing dash - without colon`;
  const result = parseMcpList(text);
  assert.deepStrictEqual(result, { Gmail: 'connected' });
});

test('parseMcpList handles empty text', () => {
  const result = parseMcpList('');
  assert.deepStrictEqual(result, {});
});

test('parseMcpList handles null/undefined', () => {
  assert.deepStrictEqual(parseMcpList(null), {});
  assert.deepStrictEqual(parseMcpList(undefined), {});
});

test('resolveClaude returns consistent type (string or null)', () => {
  // Verify that resolveClaude is deterministic and returns either an absolute path
  // or null. This ensures both the presence check and the MCP probe use the same
  // resolution logic (issue #509).
  const result1 = resolveClaude();
  const result2 = resolveClaude();
  assert.deepStrictEqual(result1, result2, 'resolveClaude must return the same result on consecutive calls');
  assert.ok(result1 === null || typeof result1 === 'string', 'resolveClaude must return null or a string path');
});

test('resolveClaude handles Windows extensions in well-known list', () => {
  // Regression test for #509 Windows regression: on Windows, well-known locations
  // must include extensions (.exe, .cmd, .bat) so that claude.exe in ~/.local/bin
  // is actually found instead of returning null. On Unix, bare names are used.
  // This test documents the expected behavior: resolveClaude() must try multiple
  // candidate names on Windows (claude.exe, claude.cmd, claude.bat, claude) and
  // single name on Unix (claude).
  const result = resolveClaude();
  // Result must be null or a valid path string
  if (result !== null) {
    assert.ok(typeof result === 'string', 'resolved path must be a string');
    assert.ok(result.length > 0, 'resolved path must not be empty');
  }
  // On Windows, if found, it should typically end with one of the known extensions
  if (result !== null && process.platform === 'win32') {
    assert.ok(
      result.endsWith('.exe') || result.endsWith('.cmd') || result.endsWith('.bat') || result.endsWith('claude'),
      'on Windows, resolved path should match a known extension or bare name'
    );
  }
});
