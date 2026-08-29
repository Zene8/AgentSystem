// calendar-event.js — output for agents to create a Calendar event.
//
// Invoked by agents (not polled). Uses the Google Calendar MCP endpoint to create a new event.
// The MCP client is injectable so tests run against stubs with zero network.
//
// Calendar is outputs-only — never polled for inbound items.

import { createClient, validateToken } from '../mcp-client.js';

const MCP_ENDPOINT = 'https://calendarmcp.googleapis.com/mcp/v1';
const ISO8601_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * Validate that a string is in ISO 8601 format (YYYY-MM-DDTHH:MM:SS[.mmm][Z|±HH:MM]).
 * @throws {Error} If the timestamp is not in ISO 8601 format.
 */
function validateISO8601(timestamp, fieldName) {
  if (!ISO8601_REGEX.test(timestamp)) {
    throw new Error(`${fieldName} must be in ISO 8601 format (YYYY-MM-DDTHH:MM:SSZ or similar): ${timestamp}`);
  }
}

/**
 * Create an MCP client for Google Calendar.
 * Validates GOOGLE_OAUTH_ACCESS_TOKEN and throws if not set.
 */
function defaultMcpClientFactory({ token = process.env.GOOGLE_OAUTH_ACCESS_TOKEN } = {}) {
  validateToken(token, 'GOOGLE_OAUTH_ACCESS_TOKEN');
  return createClient({ url: MCP_ENDPOINT, token });
}

/**
 * Create a new calendar event.
 *
 * Calls the Calendar MCP endpoint to create an event on the user's primary calendar.
 * Returns the created event ID and URL on success; on dryRun returns eventData without url/eventId.
 *
 * @param {Object} options
 * @param {string} options.title - Event title (required)
 * @param {string} options.start - Start time in ISO 8601 format, e.g. "2026-08-25T10:00:00Z" (required)
 * @param {string} options.end - End time in ISO 8601 format; must be after start (required)
 * @param {string} [options.description] - Event description
 * @param {string[]} [options.attendees] - List of attendee email addresses (requires allowInvites=true)
 * @param {boolean} [options.allowInvites=false] - If true, allow sending invitations to attendees; if false and attendees provided, throws
 * @param {Function} [options.mcpClientFactory] - Factory to create MCP client (injectable)
 * @param {boolean} [options.dryRun] - If true, return { dryRun: true, eventData } without creating or setting url/eventId
 * @returns {Promise<{ eventId: string, url: string } | { dryRun: true, eventData: Object }>}
 * @throws {Error} If validation fails, credentials missing, or end is not after start
 */
export async function createEvent({
  title,
  start,
  end,
  description = '',
  attendees = [],
  mcpClientFactory = defaultMcpClientFactory,
  dryRun = false,
  allowInvites = false,
} = {}) {
  if (!title || typeof title !== 'string') {
    throw new Error('createEvent: title is required and must be a string');
  }
  if (!start || typeof start !== 'string') {
    throw new Error('createEvent: start is required and must be an ISO 8601 timestamp');
  }
  if (!end || typeof end !== 'string') {
    throw new Error('createEvent: end is required and must be an ISO 8601 timestamp');
  }

  // Validate ISO 8601 format strictly
  validateISO8601(start, 'start');
  validateISO8601(end, 'end');

  // Validate timestamps parse correctly
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime())) {
    throw new Error('createEvent: start is not a valid ISO 8601 timestamp');
  }
  if (Number.isNaN(endDate.getTime())) {
    throw new Error('createEvent: end is not a valid ISO 8601 timestamp');
  }

  // Validate end > start
  if (endDate <= startDate) {
    throw new Error('createEvent: end must be after start');
  }

  // Guard attendees behind allowInvites flag
  if (attendees && attendees.length > 0 && !allowInvites) {
    throw new Error('createEvent: attendees require allowInvites=true to prevent unintended invitations');
  }

  // Build the event object in Google Calendar API format
  const eventData = {
    summary: title,
    description,
    start: { dateTime: start },
    end: { dateTime: end },
  };

  if (attendees && attendees.length > 0) {
    eventData.attendees = attendees.map(email => ({ email }));
  }

  if (dryRun) {
    // In dry-run mode, return what would be created (no url/eventId fields)
    return {
      dryRun: true,
      eventData,
    };
  }

  // Initialize client and create the event
  const client = mcpClientFactory();
  await client.initialize();

  try {
    // The Calendar MCP endpoint's tool for creating events
    // The exact tool name and parameters depend on the MCP server implementation
    // Common names: 'create_event', 'createEvent', 'calendar.events.insert'
    const result = await client.callTool('create_event', eventData);

    // The server should return the created event object with an id
    if (!result || !result.id) {
      throw new Error('Calendar API did not return an event id');
    }

    const eventId = result.id;
    // Google Calendar URLs follow the format: https://calendar.google.com/calendar/u/0/r/eventedit/<eventId>
    const calendarUrl = `https://calendar.google.com/calendar/u/0/r/eventedit/${eventId}`;

    return {
      eventId,
      url: calendarUrl,
    };
  } catch (err) {
    // Re-throw with context — no swallowing errors
    throw new Error(`Failed to create Calendar event: ${err.message}`);
  }
}

/**
 * CLI entry point (optional, for manual testing).
 * Usage: node tools/outbound/calendar-event.js --dry-run --title "Team Sync" --start 2026-08-25T10:00:00Z --end 2026-08-25T11:00:00Z
 */
async function main() {
  const args = process.argv.slice(2);
  let dryRun = false;
  let title = null;
  let start = null;
  let end = null;
  let description = '';
  const attendees = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dry-run') {
      dryRun = true;
    } else if (args[i] === '--title' && i + 1 < args.length) {
      title = args[++i];
    } else if (args[i] === '--start' && i + 1 < args.length) {
      start = args[++i];
    } else if (args[i] === '--end' && i + 1 < args.length) {
      end = args[++i];
    } else if (args[i] === '--description' && i + 1 < args.length) {
      description = args[++i];
    } else if (args[i] === '--attendee' && i + 1 < args.length) {
      attendees.push(args[++i]);
    }
  }

  if (!title || !start || !end) {
    console.error('Usage: node tools/outbound/calendar-event.js [--dry-run] --title <title> --start <ISO8601> --end <ISO8601> [--description <desc>] [--attendee <email>...]');
    process.exit(1);
  }

  try {
    const result = await createEvent({ title, start, end, description, attendees, dryRun });
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
