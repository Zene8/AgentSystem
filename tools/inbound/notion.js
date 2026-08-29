// notion.js — inbound adapter for Notion tasks.
//
// Design: docs/superpowers/specs/2026-08-22-inbound-event-triage-design.md
//
// Polled daily for tasks in specified databases. The MCP client is injected (`mcpClientFactory`)
// so every test runs against stubbed responses with no network.
//
// Pure: no model call, no event bus knowledge, no cursor writes. Returns normalized envelopes
// and the next cursor (a timestamp watermark). The poller advances the cursor after publishing.

import { createClient, validateToken } from '../mcp-client.js';
import { normalizeEnvelope, truncateBody } from './envelope.js';

const MCP_ENDPOINT = 'https://mcp.notion.com/mcp';

/**
 * Create an MCP client for Notion.
 * Validates NOTION_TOKEN and throws if not set.
 */
function defaultMcpClientFactory({ token = process.env.NOTION_TOKEN } = {}) {
  validateToken(token, 'NOTION_TOKEN');
  return createClient({ url: MCP_ENDPOINT, token });
}

/**
 * Build the externalId (stable dedupe key) from a Notion page.
 * Format: `notion-<page_id>-<timestamp>` where timestamp is the last-edited time.
 */
export function externalIdFor(page) {
  const pageId = page.id || '';
  const edited = page.last_edited_time ? Date.parse(page.last_edited_time) : 0;
  return `notion-${pageId}-${edited}`;
}

/**
 * Extract a human-readable title from a Notion page.
 * Pages have a properties.title field with the page title.
 */
export function getTitleFrom(page) {
  if (!page || !page.properties) return '(untitled)';
  const titleProp = page.properties.title;
  if (!titleProp || !Array.isArray(titleProp)) return '(untitled)';
  const titleBlock = titleProp[0];
  if (!titleBlock || !titleBlock.text) return '(untitled)';
  return titleBlock.text.content || '(untitled)';
}

/**
 * Build a Notion page deep link.
 */
export function pageUrlFor(page) {
  if (!page || !page.id) return 'https://www.notion.so';
  // Notion URLs are typically https://www.notion.so/<pageid>
  return `https://www.notion.so/${page.id.replace(/-/g, '')}`;
}

/**
 * Format body from a Notion page: title plus any text blocks.
 * Notion pages can be complex, but for triage purposes, the title is usually enough.
 */
export function formatBody(page) {
  const title = getTitleFrom(page);
  let body = `title: ${title}`;
  if (page.url) {
    body += `\nurl: ${page.url}`;
  }
  return truncateBody(body);
}

/**
 * Is this page worth an envelope?
 *
 * Gate on the databases list in policy. Empty or missing `policy.databases` means
 * no pages match (fail-closed). This is an allowlist.
 */
export function isInteresting(page, policy) {
  if (!policy || !policy.databases) return false;
  const allowed = policy.databases || [];
  if (allowed.length === 0) return false;
  if (!page || !page.parent) return false;

  // page.parent.database_id is the database this page lives in
  const dbId = page.parent.database_id;
  return allowed.includes(dbId);
}

/**
 * Normalize a Notion page to an envelope.
 */
function toEnvelope(page) {
  const title = getTitleFrom(page);
  return normalizeEnvelope({
    source: 'notion',
    externalId: externalIdFor(page),
    ts: page.last_edited_time || new Date().toISOString(),
    actor: page.created_by?.name || page.created_by?.id || 'Notion',
    subject: `Task: ${title}`,
    body: formatBody(page),
    url: pageUrlFor(page),
  });
}

/**
 * Poll Notion for task pages in the allowed databases.
 *
 * Returns `{ items, cursor }`. The cursor is the newest `last_edited_time` observed in this poll.
 * Items are oldest-first (by last_edited_time) so the queue drains chronologically.
 *
 * An item that fails envelope validation is skipped, not thrown: one malformed page must not
 * stop the others. A transport or auth failure DOES throw.
 *
 * @param {Object} options
 * @param {string} [options.cursor] - ISO 8601 timestamp to start after
 * @param {Object} [options.policy] - Policy with databases allowlist
 * @param {Function} [options.mcpClientFactory] - Factory to create MCP client (injectable)
 * @returns {Promise<{ items: Envelope[], cursor: string }>}
 */
export async function poll({
  cursor = null,
  policy,
  mcpClientFactory = defaultMcpClientFactory,
} = {}) {
  // Validate databases are allowed (fail-closed)
  if (!policy || !policy.databases || policy.databases.length === 0) {
    return { items: [], cursor };
  }

  const client = mcpClientFactory();
  await client.initialize();

  const items = [];
  const invalid = [];
  let newest = cursor ? Date.parse(cursor) || 0 : 0;

  // Query each database for pages
  for (const dbId of policy.databases) {
    try {
      // Use notion-query-data-sources to fetch pages from this database
      // The tool name and args follow the Notion MCP spec
      const result = await client.callTool('notion-query-data-sources', {
        source_id: dbId,
        filter: cursor ? { property: 'last_edited_time', condition: 'after', value: cursor } : undefined,
      });

      if (!Array.isArray(result)) {
        // notion-query-data-sources returns an array of pages
        continue;
      }

      for (const page of result) {
        if (!page || typeof page !== 'object') continue;

        const edited = page.last_edited_time ? Date.parse(page.last_edited_time) : 0;
        if (edited > newest) newest = edited;

        if (!isInteresting(page, policy)) continue;

        try {
          items.push(toEnvelope(page));
        } catch (err) {
          invalid.push({ id: page.id, error: err.message });
        }
      }
    } catch (err) {
      // A single database query failure should not stop other databases.
      // But a transport error or auth error should bubble up.
      if (err.message?.includes('HTTP') || err.message?.includes('timeout')) {
        throw err; // Transport error, propagate
      }
      // Database-specific errors (not found, access denied) are logged but not fatal
      invalid.push({ database: dbId, error: err.message });
    }
  }

  // Oldest first
  items.sort((a, b) => a.ts.localeCompare(b.ts));

  return {
    items,
    cursor: newest ? new Date(newest).toISOString() : cursor,
    invalid,
  };
}
