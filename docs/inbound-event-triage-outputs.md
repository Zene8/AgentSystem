# Inbound Event Triage — Outputs Layer

**Date:** 2026-08-24
**Status:** implemented, phase 5

## Overview

The outputs layer provides agents with functions to create tasks and calendar events. Unlike the inbound adapters (which are polled), outputs are invoked by agents on demand.

- **Notion tasks** (`tools/outbound/notion-task.js`): Create a new page in a Notion database
- **Calendar events** (`tools/outbound/calendar-event.js`): Create an event on Google Calendar

Both outputs use the MCP client (tools/mcp-client.js) and expect explicit OAuth credentials supplied as environment variables.

## Notion Tasks (`tools/outbound/notion-task.js`)

Creates a new Notion page in a specified database.

### Usage

```javascript
import { createTask } from './tools/outbound/notion-task.js';

const result = await createTask({
  title: 'Finish report',
  body: 'Q3 financial summary',
  databaseId: 'abc-123-def-456',
  dueDate: '2026-08-31',
  dryRun: false,
});

// Returns: { url: 'https://www.notion.so/...', pageId: '...' }
```

### Required Parameters

- **`title`** (string): Page title (required)
- **`databaseId`** (string): Target database ID (required)

### Optional Parameters

- **`body`** (string): Page description or body text
- **`dueDate`** (string): Due date in YYYY-MM-DD format
- **`moreProps`** (object): Additional Notion page properties (database schema dependent)
- **`dryRun`** (boolean, default `false`): If true, returns what would be created without writing
- **`mcpClientFactory`** (function): Injected MCP client factory (for testing)

### Environment Variable

- **`NOTION_TOKEN`**: Notion API token. Required; throws if not set.

### Error Handling

Throws with a descriptive error if:
- Title or databaseId is missing or invalid
- Notion API returns an error (e.g., 401, database not found)
- The created page response is malformed

Errors are NOT silent. A failed write will be visible to the calling agent.

### Dry-Run Mode

When `dryRun: true`, the function returns a URL starting with `[DRY-RUN]` and includes the `eventData` object showing exactly what would be created. No write occurs.

## Calendar Events (`tools/outbound/calendar-event.js`)

Creates a new event on the user's primary Google Calendar.

### Usage

```javascript
import { createEvent } from './tools/outbound/calendar-event.js';

const result = await createEvent({
  title: 'Q3 Planning Session',
  start: '2026-08-25T14:00:00Z',
  end: '2026-08-25T15:00:00Z',
  description: 'Review and finalize Q3 roadmap',
  attendees: ['alice@example.com', 'bob@example.com'],
  dryRun: false,
});

// Returns: { eventId: '...', url: 'https://calendar.google.com/...' }
```

### Required Parameters

- **`title`** (string): Event title (required)
- **`start`** (string): Start time in ISO 8601 format, e.g., `'2026-08-25T14:00:00Z'` (required)
- **`end`** (string): End time in ISO 8601 format (required)

### Optional Parameters

- **`description`** (string): Event description
- **`attendees`** (string[]): List of attendee email addresses
- **`dryRun`** (boolean, default `false`): If true, returns what would be created without writing
- **`mcpClientFactory`** (function): Injected MCP client factory (for testing)

### Environment Variable

- **`GOOGLE_OAUTH_ACCESS_TOKEN`**: Google OAuth 2.0 access token. Required; throws if not set.

**Note:** Calendar is currently disabled in `claude mcp list` and must be re-enabled interactively before the output can be exercised live.

### Error Handling

Throws with a descriptive error if:
- Title, start, or end is missing or invalid
- Timestamps are not valid ISO 8601 format
- Google Calendar API returns an error (e.g., 401, quota exceeded)
- The created event response is malformed

Errors are NOT silent. A failed write will be visible to the calling agent.

### Dry-Run Mode

When `dryRun: true`, the function returns a URL starting with `[DRY-RUN]` and includes the `eventData` object showing exactly what would be created. No write occurs.

## Credentials

Neither output should read credentials from Claude Code's credential store (`~/.claude/.credentials.json` or any keychain). Credentials are **explicit environment variables only**:

- **Notion:** `NOTION_TOKEN`
- **Calendar:** `GOOGLE_OAUTH_ACCESS_TOKEN`

An adapter that borrows the user's interactive session credentials is credential exfiltration and is out of bounds.

Both variables are required at runtime. If unset, the output throws with a clear error message naming the variable that should be set.

## Testing

All tests run against stubbed MCP clients with **zero network**. The MCP client is injected via the `mcpClientFactory` parameter:

```javascript
// Test with a stub:
const stubFactory = () => ({
  async initialize() {},
  async callTool(name, args) {
    return { id: 'test-id' };
  },
});

const result = await createTask({
  title: 'Test',
  databaseId: 'db-123',
  mcpClientFactory: stubFactory,
});
```

Test coverage includes:
- Happy path (create succeeds)
- Dry-run mode (no write, returns rendered output)
- Missing required parameters
- Invalid parameter formats (e.g., non-ISO 8601 timestamps)
- API errors (401, 404, 500) propagate
- Malformed API responses are caught
- Missing credentials throw naming the env var
- Only read-only tools are called (no unexpected mutations)

## MCP Endpoints

- **Notion:** `https://mcp.notion.com/mcp`
  - Tools: `notion-create-pages`, `notion-query-data-sources`, `notion-fetch`, etc.

- **Google Calendar:** `https://calendarmcp.googleapis.com/mcp/v1`
  - Tool: `create_event`

Neither endpoint should be called for any purpose other than the outputs they support.

## Invocation Patterns

Outputs are always invoked by agents, never by timers or pollers. Examples:

- An agent processing a Notion task from the inbound poller creates a follow-up Calendar event.
- An agent writing a draft PR includes a commit with a message that invokes `createTask` to track the work item in Notion.
- A scheduled job (e.g., weekly sync) creates a Calendar event for next week's meeting.

## Failure Modes

| Failure | Behavior |
|---|---|
| Missing env var | Throws immediately, naming the env var |
| Network/timeout | Throws with the MCP client's error message |
| Invalid parameters | Throws with validation error before any write |
| API rejects request | Throws with server's error message; no retry |
| Malformed response | Throws; does not fall back to a partial result |
| Dry-run requested | Returns rendered output, no write, no error |

There is no silent failure mode. An agent that fails to create a task or event gets a clear error.
