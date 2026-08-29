// notion-task.js — output for agents to create a Notion task.
//
// Invoked by agents (not polled). Uses the Notion MCP endpoint to create a new page
// in a specified database. The MCP client is injectable so tests run against stubs with zero network.
//
// Never use this to read or list tasks — that is the adapter's job (tools/inbound/notion.js).
// This output only creates new pages.

import { createClient, validateToken } from '../mcp-client.js';

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
 * Create a new Notion task in a database.
 *
 * Calls `notion-create-pages` with the given properties. The page is created and
 * a URL is returned. Only the title property is created; additional properties must be
 * passed via `moreProps` with values matching your database schema.
 *
 * @param {Object} options
 * @param {string} options.title - Page title (required)
 * @param {string} options.databaseId - Database ID to create the page in (required)
 * @param {Object} [options.moreProps] - Additional Notion page properties as property name/value pairs.
 *   The caller is responsible for valid schema: property names and values must match the database.
 * @param {Function} [options.mcpClientFactory] - Factory to create MCP client (injectable)
 * @param {boolean} [options.dryRun] - If true, return what would be created without creating it
 * @returns {Promise<{ pageId: string, url: string }>} Created page ID and URL
 * @returns {Promise<{ dryRun: boolean, pageData: Object }>} Dry-run result with no url/pageId
 * @throws {Error} If the write fails or credentials are missing
 */
export async function createTask({
  title,
  databaseId,
  moreProps = {},
  mcpClientFactory = defaultMcpClientFactory,
  dryRun = false,
} = {}) {
  if (!title || typeof title !== 'string') {
    throw new Error('createTask: title is required and must be a string');
  }
  if (!databaseId || typeof databaseId !== 'string') {
    throw new Error('createTask: databaseId is required and must be a string');
  }

  // Build the page properties. In Notion, properties vary by database schema.
  // Title is always present as a property; additional properties come from moreProps.
  const properties = {
    title: [
      {
        type: 'text',
        text: { content: title },
      },
    ],
    ...moreProps,
  };

  const pageData = {
    parent: {
      type: 'database_id',
      database_id: databaseId,
    },
    properties,
  };

  if (dryRun) {
    // In dry-run mode, return what would be created; no url/pageId fields
    return {
      dryRun: true,
      pageData,
    };
  }

  // Initialize client and create the page
  const client = mcpClientFactory();
  await client.initialize();

  try {
    const result = await client.callTool('notion-create-pages', {
      properties,
      parent: pageData.parent,
    });

    // notion-create-pages should return the created page object
    if (!result || !result.id) {
      throw new Error('notion-create-pages did not return a page id');
    }

    // Build the URL for the created page
    const pageId = result.id;
    const pageUrl = `https://www.notion.so/${pageId.replace(/-/g, '')}`;

    return {
      url: pageUrl,
      pageId,
    };
  } catch (err) {
    // Re-throw with context — no swallowing errors
    throw new Error(`Failed to create Notion task: ${err.message}`);
  }
}

/**
 * CLI entry point (optional, for manual testing).
 * Usage: node tools/outbound/notion-task.js --dry-run --title "Test Task" --db abc123
 */
async function main() {
  const args = process.argv.slice(2);
  let dryRun = false;
  let title = null;
  let databaseId = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dry-run') {
      dryRun = true;
    } else if (args[i] === '--title' && i + 1 < args.length) {
      title = args[++i];
    } else if (args[i] === '--db' && i + 1 < args.length) {
      databaseId = args[++i];
    }
  }

  if (!title || !databaseId) {
    console.error('Usage: node tools/outbound/notion-task.js [--dry-run] --title <title> --db <databaseId>');
    process.exit(1);
  }

  try {
    const result = await createTask({ title, databaseId, dryRun });
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

// Only run main if this is the entry point
import { isMainModule } from '../is-main.js';
if (isMainModule(import.meta.url)) {
  main();
}
