
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

// Test configuration
const timeZone = 'America/New_York';

const platform = {
  usesColors: true,
};

const postTypes = [
  { id: 20, sortOrder: 2 },
  { id: 10, sortOrder: 1 },
];

// New scheduling system uses schedule rules.
const scheduleRules = [
  {
    id: 1,
    byDay: 'MO,FR',
    time: '13:00',
    startDate: '2026-01-01',
    endDate: null,
    intervalWeeks: 1,
    postTypeIds: [],
    sortOrder: 0,
    active: true,
  },
];

// TC-011: Month validation
test('TC-011: Validate month format', () => {
  assert.deepEqual(
    parseMonth('2026-11'),
    [2026, 11]
  );

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
    platform,
    scheduleRules,
    postTypes,
    2026,
    1,
    timeZone
  );

  // January 2026 has 9 Mondays and Fridays.
  assert.equal(slots.length, 9);

  assert.equal(slots[0].date, '2026-01-02');
  assert.equal(slots[1].date, '2026-01-05');
  assert.equal(slots[8].date, '2026-01-30');

  // 1 PM Eastern = 6 PM UTC in January.
  assert.equal(
    slots[0].scheduledAt,
    '2026-01-02T18:00:00.000Z'
  );

  assert.equal(slots[0].time, '13:00');
  assert.equal(slots[0].ruleId, 1);
});

// TC-015: Alternate colors and post types
test('TC-015: Alternate colors and post types', () => {
  const slots = monthBlueprint(
    platform,
    scheduleRules,
    postTypes,
    2026,
    1,
    timeZone
  );

  assert.deepEqual(
    COLORS,
    ['Blue', 'Purple']
  );

  assert.deepEqual(
    slots.slice(0, 3).map(slot => slot.color),
    ['Blue', 'Purple', 'Blue']
  );

  // Post types follow sortOrder.
  assert.deepEqual(
    slots.slice(0, 3).map(slot => slot.postTypeId),
    [10, 20, 10]
  );
});

// TC-016: Continue rotation between months
test('TC-016: Continue rotation across months', () => {
  const january = monthBlueprint(
    platform,
    scheduleRules,
    postTypes,
    2026,
    1,
    timeZone
  );

  const february = monthBlueprint(
    platform,
    scheduleRules,
    postTypes,
    2026,
    2,
    timeZone
  );

  // January ends with Blue.
  assert.equal(
    january.at(-1).color,
    'Blue'
  );

  // February continues with Purple.
  assert.equal(
    february[0].color,
    'Purple'
  );

  // Post type rotation must continue as well.
  assert.equal(
    january.at(-1).postTypeId,
    10
  );

  assert.equal(
    february[0].postTypeId,
    20
  );
});

// TC-017: Handle multiple posting times
test('TC-017: Handle multiple posting times', () => {
  const noColorPlatform = {
    usesColors: false,
  };

  const rules = [
    {
      id: 1,
      byDay: 'FR',
      time: '17:00',
      startDate: '2026-01-01',
      endDate: null,
      intervalWeeks: 1,
      postTypeIds: [],
      sortOrder: 0,
      active: true,
    },
    {
      id: 2,
      byDay: 'FR',
      time: '09:00',
      startDate: '2026-01-01',
      endDate: null,
      intervalWeeks: 1,
      postTypeIds: [],
      sortOrder: 1,
      active: true,
    },
  ];

  const slots = monthBlueprint(
    noColorPlatform,
    rules,
    [],
    2026,
    1,
    timeZone
  );

  // Five Fridays, two posting times each.
  assert.equal(slots.length, 10);

  // Times must appear in chronological order.
  assert.equal(slots[0].time, '09:00');
  assert.equal(slots[1].time, '17:00');

  assert.equal(slots[0].date, '2026-01-02');
  assert.equal(slots[1].date, '2026-01-02');

  // Platform without color rotation.
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
    fitsSlot(
      slot,
      { postTypeId: 1, color: 'Blue' },
      true
    ),
    true
  );

  assert.equal(
    fitsSlot(
      slot,
      { postTypeId: 1, color: 'Purple' },
      true
    ),
    false
  );

  assert.equal(
    fitsSlot(
      slot,
      { postTypeId: 2, color: 'Blue' },
      true
    ),
    false
  );

  // Color does not matter for platforms
  // that do not use color rotation.
  assert.equal(
    fitsSlot(
      slot,
      { postTypeId: 1, color: 'Purple' },
      false
    ),
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

  assert.deepEqual(
    fillSlots(slots, posts, true),
    [
      { slotId: 102, postId: 203 },
      { slotId: 101, postId: 204 },
      { slotId: 103, postId: 202 },
    ]
  );
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

  // Colors are ignored when usesColors = false.
  assert.deepEqual(
    fillSlots(slots, posts, false),
    [
      { slotId: 1, postId: 55 },
    ]
  );
});


 // TC-021: Holiday insertion shifts future colors
test('TC-021: Holiday insertion shifts all later color rotations', () => {
  // Generate the original January schedule.
  const original = monthBlueprint(
    platform,
    scheduleRules,
    postTypes,
    2026,
    1,
    timeZone
  );

  // Insert a Blue holiday post on January 8.
  const holiday = [{
    date: '2026-01-08',
    time: '12:00',
    color: 'Blue',
    blocksDay: true,
  }];

  // Generate the schedule with the holiday.
  const updated = monthBlueprint(
    platform,
    scheduleRules,
    postTypes,
    2026,
    1,
    timeZone,
    holiday
  );

  // The holiday must not change earlier slots.
  const earlier = original.filter(
    slot => slot.date < '2026-01-08'
  );

  for (const slot of earlier) {
    const changed = updated.find(
      s => s.date === slot.date && s.time === slot.time
    );

    assert.equal(changed.color, slot.color);
  }

  // All later colors must shift.
  const later = original.filter(
    slot => slot.date > '2026-01-08'
  );

  assert.ok(later.length > 0);

  for (const slot of later) {
    const changed = updated.find(
      s => s.date === slot.date && s.time === slot.time
    );

    assert.equal(
      changed.color,
      slot.color === 'Blue' ? 'Purple' : 'Blue'
    );
  }

  // Verify the change continues into February.
  const februaryOriginal = monthBlueprint(
    platform, scheduleRules, postTypes,
    2026, 2, timeZone
  );

  const februaryUpdated = monthBlueprint(
    platform, scheduleRules, postTypes,
    2026, 2, timeZone, holiday
  );

  assert.equal(
    februaryUpdated[0].color,
    februaryOriginal[0].color === 'Blue'
      ? 'Purple'
      : 'Blue'
  );

  // Inserting a holiday must not change post types.
  assert.deepEqual(
    updated.map(slot => slot.postTypeId),
    original.map(slot => slot.postTypeId)
  );
});


 // TC-116: Verify biweekly recurring schedules
test('TC-116: Generate biweekly posting slots correctly', () => {
  const rule = [{
    id: 1,
    byDay: 'MO',
    time: '13:00',
    startDate: '2026-01-05',
    endDate: null,
    intervalWeeks: 2,
    postTypeIds: [],
    active: true,
  }];

  const platform = { usesColors: false };

  const types = [
    { id: 10, sortOrder: 1 },
    { id: 20, sortOrder: 2 },
  ];

  const january = monthBlueprint(
    platform, rule, types, 2026, 1, timeZone
  );

  const february = monthBlueprint(
    platform, rule, types, 2026, 2, timeZone
  );

  const march = monthBlueprint(
    platform, rule, types, 2026, 3, timeZone
  );

  // Posts occur every other Monday.
  assert.deepEqual(
    january.map(s => s.date),
    ['2026-01-05', '2026-01-19']
  );

  assert.deepEqual(
    february.map(s => s.date),
    ['2026-02-02', '2026-02-16']
  );

  assert.deepEqual(
    march.map(s => s.date),
    ['2026-03-02', '2026-03-16', '2026-03-30']
  );

  // Post type rotation continues across months.
  assert.deepEqual(
    [...january, ...february, ...march]
      .map(s => s.postTypeId),
    [10, 20, 10, 20, 10, 20, 10]
  );

  // The local posting time remains 1 PM.
  assert.ok(
    [...january, ...february, ...march]
      .every(s => s.time === '13:00')
  );

  // Verify daylight saving time conversion.
  assert.equal(
    january[0].scheduledAt,
    '2026-01-05T18:00:00.000Z'
  );

  assert.equal(
    march[1].scheduledAt,
    '2026-03-16T17:00:00.000Z'
  );
});

