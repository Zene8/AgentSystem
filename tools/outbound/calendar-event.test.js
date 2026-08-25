// Tests for tools/outbound/calendar-event.js. All API calls are stubbed — no network, no MCP client.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createEvent } from './calendar-event.js';

function stubClientFactory(response = { id: 'event123' }) {
  return () => {
    const calls = [];
    return {
      async initialize() {},
      async callTool(name, args) {
        calls.push({ name, args });
        if (name === 'create_event') {
          if (response instanceof Error) throw response;
          return response;
        }
        throw new Error(`Unexpected tool: ${name}`);
      },
    };
  };
}

test('createEvent creates an event with title, start, and end', async () => {
  const factory = stubClientFactory({ id: 'evt123' });
  const result = await createEvent({
    title: 'Team Sync',
    start: '2026-08-25T10:00:00Z',
    end: '2026-08-25T11:00:00Z',
    mcpClientFactory: factory,
  });

  assert.ok(result.url, 'should return a url');
  assert.ok(result.url.includes('calendar.google.com'), 'url should be a Calendar link');
  assert.equal(result.eventId, 'evt123');
});

test('createEvent requires title', async () => {
  const factory = stubClientFactory();
  try {
    await createEvent({
      start: '2026-08-25T10:00:00Z',
      end: '2026-08-25T11:00:00Z',
      mcpClientFactory: factory,
    });
    assert.fail('Expected error for missing title');
  } catch (err) {
    assert.match(err.message, /title is required/);
  }
});

test('createEvent requires start', async () => {
  const factory = stubClientFactory();
  try {
    await createEvent({
      title: 'Team Sync',
      end: '2026-08-25T11:00:00Z',
      mcpClientFactory: factory,
    });
    assert.fail('Expected error for missing start');
  } catch (err) {
    assert.match(err.message, /start is required/);
  }
});

test('createEvent requires end', async () => {
  const factory = stubClientFactory();
  try {
    await createEvent({
      title: 'Team Sync',
      start: '2026-08-25T10:00:00Z',
      mcpClientFactory: factory,
    });
    assert.fail('Expected error for missing end');
  } catch (err) {
    assert.match(err.message, /end is required/);
  }
});

test('createEvent validates ISO 8601 timestamps', async () => {
  const factory = stubClientFactory();
  try {
    await createEvent({
      title: 'Team Sync',
      start: 'not-a-date',
      end: '2026-08-25T11:00:00Z',
      mcpClientFactory: factory,
    });
    assert.fail('Expected error for invalid start timestamp');
  } catch (err) {
    assert.match(err.message, /ISO 8601 timestamp/);
  }
});

test('createEvent calls create_event with correct structure', async () => {
  let capturedCall = null;
  const factory = () => {
    return {
      async initialize() {},
      async callTool(name, args) {
        capturedCall = { name, args };
        return { id: 'test-event' };
      },
    };
  };

  await createEvent({
    title: 'Test Event',
    start: '2026-08-25T10:00:00Z',
    end: '2026-08-25T11:00:00Z',
    mcpClientFactory: factory,
  });

  assert.equal(capturedCall.name, 'create_event');
  assert.equal(capturedCall.args.summary, 'Test Event');
  assert.equal(capturedCall.args.start.dateTime, '2026-08-25T10:00:00Z');
  assert.equal(capturedCall.args.end.dateTime, '2026-08-25T11:00:00Z');
});

test('createEvent accepts description', async () => {
  let capturedCall = null;
  const factory = () => {
    return {
      async initialize() {},
      async callTool(name, args) {
        capturedCall = { name, args };
        return { id: 'test-event' };
      },
    };
  };

  await createEvent({
    title: 'Test Event',
    start: '2026-08-25T10:00:00Z',
    end: '2026-08-25T11:00:00Z',
    description: 'Discuss Q3 planning',
    mcpClientFactory: factory,
  });

  assert.equal(capturedCall.args.description, 'Discuss Q3 planning');
});

test('createEvent accepts attendees', async () => {
  let capturedCall = null;
  const factory = () => {
    return {
      async initialize() {},
      async callTool(name, args) {
        capturedCall = { name, args };
        return { id: 'test-event' };
      },
    };
  };

  await createEvent({
    title: 'Test Event',
    start: '2026-08-25T10:00:00Z',
    end: '2026-08-25T11:00:00Z',
    attendees: ['alice@example.com', 'bob@example.com'],
    mcpClientFactory: factory,
  });

  assert.ok(capturedCall.args.attendees, 'should have attendees');
  assert.equal(capturedCall.args.attendees.length, 2);
  assert.equal(capturedCall.args.attendees[0].email, 'alice@example.com');
});

test('createEvent in dry-run mode returns what would be created', async () => {
  const factory = stubClientFactory();
  const result = await createEvent({
    title: 'Team Sync',
    start: '2026-08-25T10:00:00Z',
    end: '2026-08-25T11:00:00Z',
    mcpClientFactory: factory,
    dryRun: true,
  });

  assert.equal(result.dryRun, true);
  assert.match(result.url, /DRY-RUN/);
  assert.match(result.url, /Team Sync/);
  assert.ok(result.eventData, 'should include eventData in dry-run');
});

test('createEvent propagates API errors', async () => {
  const factory = stubClientFactory(new Error('create_event: 401 Unauthorized'));
  try {
    await createEvent({
      title: 'Team Sync',
      start: '2026-08-25T10:00:00Z',
      end: '2026-08-25T11:00:00Z',
      mcpClientFactory: factory,
    });
    assert.fail('Expected error to propagate');
  } catch (err) {
    assert.match(err.message, /Failed to create Calendar event/);
    assert.match(err.message, /401 Unauthorized/);
  }
});

test('createEvent throws when API does not return event id', async () => {
  const factory = stubClientFactory({ /* no id */ });
  try {
    await createEvent({
      title: 'Team Sync',
      start: '2026-08-25T10:00:00Z',
      end: '2026-08-25T11:00:00Z',
      mcpClientFactory: factory,
    });
    assert.fail('Expected error for missing event id');
  } catch (err) {
    assert.match(err.message, /did not return an event id/);
  }
});

test('createEvent throws when GOOGLE_OAUTH_ACCESS_TOKEN is not set', async () => {
  const origToken = process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
  delete process.env.GOOGLE_OAUTH_ACCESS_TOKEN;

  try {
    await createEvent({
      title: 'Test',
      start: '2026-08-25T10:00:00Z',
      end: '2026-08-25T11:00:00Z',
    });
    assert.fail('Expected GOOGLE_OAUTH_ACCESS_TOKEN error');
  } catch (err) {
    assert.match(err.message, /GOOGLE_OAUTH_ACCESS_TOKEN/);
  } finally {
    if (origToken) process.env.GOOGLE_OAUTH_ACCESS_TOKEN = origToken;
  }
});

test('createEvent never calls tools other than create_event', async () => {
  const factory = () => {
    return {
      async initialize() {},
      async callTool(name, args) {
        if (name !== 'create_event') {
          throw new Error(`Unexpected tool: ${name}`);
        }
        return { id: 'test' };
      },
    };
  };

  // Should succeed without trying other tools
  const result = await createEvent({
    title: 'Test',
    start: '2026-08-25T10:00:00Z',
    end: '2026-08-25T11:00:00Z',
    mcpClientFactory: factory,
  });
  assert.ok(result.url);
});

test('createEvent builds correct Google Calendar URL from event id', async () => {
  const factory = stubClientFactory({ id: 'abc123def456' });
  const result = await createEvent({
    title: 'Test',
    start: '2026-08-25T10:00:00Z',
    end: '2026-08-25T11:00:00Z',
    mcpClientFactory: factory,
  });

  assert.match(result.url, /abc123def456/);
  assert.ok(result.url.includes('eventedit'), 'URL should be an edit link');
});

test('createEvent does not require attendees', async () => {
  let capturedCall = null;
  const factory = () => {
    return {
      async initialize() {},
      async callTool(name, args) {
        capturedCall = { name, args };
        return { id: 'test-event' };
      },
    };
  };

  await createEvent({
    title: 'Personal Event',
    start: '2026-08-25T10:00:00Z',
    end: '2026-08-25T11:00:00Z',
    mcpClientFactory: factory,
  });

  // attendees should not be present if not provided
  if (capturedCall.args.attendees) {
    assert.equal(capturedCall.args.attendees.length, 0);
  }
});
