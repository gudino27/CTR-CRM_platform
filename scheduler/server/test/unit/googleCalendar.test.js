
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildEvent,
} from '../../src/services/googleCalendar.js';

import {
  config,
} from '../../src/config.js';

const platform = {
  name: 'Instagram',
  calendarColorId: '5',
};

const post = {
  id: 123,
  caption: 'Test social media post',
  hashtags: '#CTR #Nonprofit',
};

const slot = new Date('2026-11-09T18:00:00Z');

const createEvent = (overrides = {}) =>
  buildEvent({
    platform,
    post,
    slot,
    ...overrides,
  });

// TC-046: Validate event title
test('TC-046: Set correct calendar event title', () => {
  const event = createEvent();

  assert.equal(event.summary, 'Instagram');
});

// TC-047: Validate event description
test('TC-047: Include caption and hashtags', () => {
  const event = createEvent();

  assert.ok(
    event.description.startsWith(
      'Test social media post\n\n#CTR #Nonprofit'
    )
  );
});

// TC-048: Validate default event duration
test('TC-048: Use default 15-minute duration', () => {
  const event = createEvent();

  assert.equal(
    event.start.dateTime,
    '2026-11-09T18:00:00.000Z'
  );

  assert.equal(
    event.end.dateTime,
    '2026-11-09T18:15:00.000Z'
  );
});

// TC-049: Validate custom event duration
test('TC-049: Support custom event duration', () => {
  const event = createEvent({
    durationMinutes: 30,
  });

  assert.equal(
    event.end.dateTime,
    '2026-11-09T18:30:00.000Z'
  );
});

// TC-050: Validate event color
test('TC-050: Set calendar event color', () => {
  const event = createEvent();

  assert.equal(event.colorId, '5');

  const noColor = createEvent({
    platform: { name: 'LinkedIn' },
  });

  assert.equal(noColor.colorId, undefined);
});

// TC-051: Validate post identification
test('TC-051: Store post ID in event metadata', () => {
  const event = createEvent();

  assert.deepEqual(event.extendedProperties, {
    private: {
      postId: '123',
    },
  });
});

// TC-052: Validate configured timezone
test('TC-052: Use application timezone', () => {
  const event = createEvent();

  assert.equal(
    event.start.timeZone,
    config.timezone
  );

  assert.equal(
    event.end.timeZone,
    config.timezone
  );
});
