
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseDateString,
  localDateString,
  atLocalTime,
  offsetIso,
  parseLocalDateTime,
} from '../../src/services/time.js';


// TC-001: Validate correct dates
test('TC-001: Accept valid dates', () => {
  assert.deepEqual(
    parseDateString('2026-11-09'),
    [2026, 11, 9]
  );
});

// TC-002: Reject invalid dates
test('TC-002: Reject invalid dates', () => {
  assert.equal(parseDateString('2026-02-30'), null);
  assert.equal(parseDateString('2026-13-01'), null);
  assert.equal(parseDateString('invalid'), null);
});

// TC-003: Handle time-zone date changes
test('TC-003: Convert UTC to local date', () => {
  const date = new Date('2026-11-09T01:30:00Z');

  assert.equal(
    localDateString(date, 'America/Los_Angeles'),
    '2026-11-08'
  );
});


// TC-004: Convert Eastern time to UTC
test('TC-004: Convert local posting time to UTC', () => {
  const result = atLocalTime(
    '2026-11-09',
    '13:00',
    'America/New_York'
  );

  assert.equal(
    result.toISOString(),
    '2026-11-09T18:00:00.000Z'
  );
});

// TC-005: Format time with UTC offset
test('TC-005: Format local time with UTC offset', () => {
  const date = new Date('2026-11-09T18:00:00Z');

  assert.equal(
    offsetIso(date, 'America/New_York'),
    '2026-11-09T13:00:00-05:00'
  );
});


// TC-006: Spring DST transition
test('TC-006: Handle spring daylight saving time', () => {
  const beforeDST = atLocalTime(
    '2026-03-07', '13:00', 'America/New_York'
  );

  const afterDST = atLocalTime(
    '2026-03-08', '13:00', 'America/New_York'
  );

  assert.equal(
    beforeDST.toISOString(),
    '2026-03-07T18:00:00.000Z'
  );

  assert.equal(
    afterDST.toISOString(),
    '2026-03-08T17:00:00.000Z'
  );
});

// TC-007: Fall DST transition
test('TC-007: Handle fall daylight saving time', () => {
  const beforeDST = atLocalTime(
    '2026-10-31', '13:00', 'America/New_York'
  );

  const afterDST = atLocalTime(
    '2026-11-01', '13:00', 'America/New_York'
  );

  assert.equal(
    beforeDST.toISOString(),
    '2026-10-31T17:00:00.000Z'
  );

  assert.equal(
    afterDST.toISOString(),
    '2026-11-01T18:00:00.000Z'
  );
});


// TC-008: Reject invalid date and time formats
test('TC-008: Reject invalid date-time inputs', () => {
  assert.equal(
    parseLocalDateTime('2026-02-30T13:00', 'America/New_York'),
    null
  );

  assert.equal(
    parseLocalDateTime('2026-11-09T25:00', 'America/New_York'),
    null
  );

  assert.equal(
    parseLocalDateTime('2026-11-09T13:75', 'America/New_York'),
    null
  );

  assert.equal(
    parseLocalDateTime('invalid', 'America/New_York'),
    null
  );
});

// TC-009: Accept valid local date-time inputs
test('TC-009: Accept valid local date-time', () => {
  const result = parseLocalDateTime(
    '2026-11-09T13:00',
    'America/New_York'
  );

  assert.equal(
    result.toISOString(),
    '2026-11-09T18:00:00.000Z'
  );
});

// TC-010: Handle date changes across years
test('TC-010: Handle year boundary correctly', () => {
  const before = new Date('2027-01-01T03:30:00Z');
  const after = new Date('2027-01-01T05:30:00Z');

  assert.equal(
    localDateString(before, 'America/New_York'),
    '2026-12-31'
  );

  assert.equal(
    localDateString(after, 'America/New_York'),
    '2027-01-01'
  );
});

