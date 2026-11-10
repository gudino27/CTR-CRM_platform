
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  COLORS,
  parseMonth,
  monthsFrom,
  monthsBetween,
  monthBlueprint,
  fitsSlot,
  fillSlots,
} from '../../src/services/projection.js';

const timeZone = 'America/New_York';

const platform = {
  postingDays: ['MON', 'FRI'],
  postingTimes: ['13:00'],
  usesColors: true,
};

const postTypes = [
  { id: 20, sortOrder: 2 },
  { id: 10, sortOrder: 1 },
];

// TC-011: Month validation
test('TC-011: Validate month format', () => {
  assert.deepEqual(parseMonth('2026-11'), [2026, 11]);
  assert.equal(parseMonth('2026-13'), null);
  assert.equal(parseMonth('2026-00'), null);
  assert.equal(parseMonth('2026-1'), null);
  assert.equal(parseMonth('invalid'), null);
});

// TC-012: Generate consecutive months
test('TC-012: Generate months across year boundary', () => {
  const date = new Date('2027-01-01T02:00:00Z');

  assert.deepEqual(
    monthsFrom(date, 3, timeZone),
    ['2026-12', '2027-01', '2027-02']
  );
});

// TC-013: Calculate inclusive month range
test('TC-013: Calculate months between dates', () => {
  const from = new Date('2026-11-15T12:00:00Z');
  const to = new Date('2027-01-15T12:00:00Z');

  assert.deepEqual(
    monthsBetween(from, to, timeZone),
    ['2026-11', '2026-12', '2027-01']
  );
});

// TC-014: Generate slots on configured days
test('TC-014: Generate correct posting days', () => {
  const slots = monthBlueprint(
    platform, postTypes, 2026, 1, timeZone
  );

  assert.equal(slots.length, 9);
  assert.equal(slots[0].date, '2026-01-02');
  assert.equal(slots[1].date, '2026-01-05');
  assert.equal(slots[8].date, '2026-01-30');

  assert.equal(
    slots[0].scheduledAt,
    '2026-01-02T18:00:00.000Z'
  );
});

// TC-015: Alternate colors and post types
test('TC-015: Alternate colors and post types', () => {
  const slots = monthBlueprint(
    platform, postTypes, 2026, 1, timeZone
  );

  assert.deepEqual(COLORS, ['Blue', 'Purple']);

  assert.deepEqual(
    slots.slice(0, 3).map((slot) => slot.color),
    ['Blue', 'Purple', 'Blue']
  );

  assert.deepEqual(
    slots.slice(0, 3).map((slot) => slot.postTypeId),
    [10, 20, 10]
  );
});

// TC-016: Continue rotation between months
test('TC-016: Continue rotation across months', () => {
  const january = monthBlueprint(
    platform, postTypes, 2026, 1, timeZone
  );

  const february = monthBlueprint(
    platform, postTypes, 2026, 2, timeZone
  );

  assert.equal(january.at(-1).color, 'Blue');
  assert.equal(february[0].color, 'Purple');

  assert.equal(january.at(-1).postTypeId, 10);
  assert.equal(february[0].postTypeId, 20);
});

// TC-017: Sort posting times and support no colors
test('TC-017: Handle multiple posting times', () => {
  const noColorPlatform = {
    postingDays: ['FRI'],
    postingTimes: ['17:00', '09:00'],
    usesColors: false,
  };

  const slots = monthBlueprint(
    noColorPlatform, [], 2026, 1, timeZone
  );

  assert.equal(slots[0].time, '09:00');
  assert.equal(slots[1].time, '17:00');

  assert.equal(slots[0].color, null);
  assert.equal(slots[0].postTypeId, null);
});

// TC-018: Match post types and colors
test('TC-018: Match posts to compatible slots', () => {
  const slot = {
    postTypeId: 1,
    color: 'Blue',
  };

  assert.equal(
    fitsSlot(slot, { postTypeId: 1, color: 'Blue' }, true),
    true
  );

  assert.equal(
    fitsSlot(slot, { postTypeId: 1, color: 'Purple' }, true),
    false
  );

  assert.equal(
    fitsSlot(slot, { postTypeId: 2, color: 'Blue' }, true),
    false
  );

  assert.equal(
    fitsSlot(slot, { postTypeId: 1, color: 'Purple' }, false),
    true
  );
});

// TC-019: Fill slots using oldest matching posts
test('TC-019: Assign posts in correct order', () => {
  const slots = [
    {
      id: 101,
      scheduledAt: '2026-11-13T18:00:00.000Z',
      postTypeId: 1,
      color: 'Purple',
    },
    {
      id: 102,
      scheduledAt: '2026-11-09T18:00:00.000Z',
      postTypeId: 1,
      color: 'Blue',
    },
    {
      id: 103,
      scheduledAt: '2026-11-16T18:00:00.000Z',
      postTypeId: 1,
      color: 'Blue',
    },
  ];

  const posts = [
    {
      id: 202,
      postTypeId: 1,
      color: 'Blue',
      createdAt: '2026-11-07T12:00:00Z',
    },
    {
      id: 204,
      postTypeId: 1,
      color: 'Purple',
      createdAt: '2026-11-01T12:00:00Z',
    },
    {
      id: 203,
      postTypeId: 1,
      color: 'Blue',
      createdAt: '2026-11-06T12:00:00Z',
    },
  ];

  assert.deepEqual(fillSlots(slots, posts, true), [
    { slotId: 102, postId: 203 },
    { slotId: 101, postId: 204 },
    { slotId: 103, postId: 202 },
  ]);
});

// TC-020: Skip slots without compatible posts
test('TC-020: Skip unmatched slots', () => {
  const slots = [
    {
      id: 1,
      scheduledAt: '2026-11-09T18:00:00Z',
      postTypeId: 7,
      color: 'Purple',
    },
    {
      id: 2,
      scheduledAt: '2026-11-10T18:00:00Z',
      postTypeId: 99,
      color: 'Blue',
    },
  ];

  const posts = [
    {
      id: 55,
      postTypeId: 7,
      color: 'Blue',
      createdAt: '2026-11-01T12:00:00Z',
    },
  ];

  assert.deepEqual(fillSlots(slots, posts, false), [
    { slotId: 1, postId: 55 },
  ]);
});

// Pending client requirements.
// These are not yet executable tests.

test.todo(
  'TC-021: Holiday insertion shifts all later color rotations'
);

test.todo(
  'TC-022: Posting day changes offer preserve or move options'
);

test.todo(
  'TC-023: Slot post type changes support rotation choices'
);
