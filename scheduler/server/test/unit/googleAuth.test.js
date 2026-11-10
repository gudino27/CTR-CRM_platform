
import test from 'node:test';
import assert from 'node:assert/strict';

import { googleOAuthClient } from '../../src/services/googleAuth.js';
import { createCalendarClient } from '../../src/services/googleCalendar.js';

// Dummy credentials only. No real Google account is used.
const googleConfig = {
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  refreshToken: 'test-refresh-token',
  calendarId: 'test-calendar@example.invalid',
};

// TC-053: Reject missing Client ID
test('TC-053: Reject missing Google Client ID', () => {
  const result = googleOAuthClient({
    ...googleConfig,
    clientId: '',
  });

  assert.equal(result, null);
});

// TC-054: Reject missing Client Secret
test('TC-054: Reject missing Google Client Secret', () => {
  const result = googleOAuthClient({
    ...googleConfig,
    clientSecret: '',
  });

  assert.equal(result, null);
});

// TC-055: Reject missing Refresh Token
test('TC-055: Reject missing Google Refresh Token', () => {
  const result = googleOAuthClient({
    ...googleConfig,
    refreshToken: '',
  });

  assert.equal(result, null);
});

// TC-056: Initialize OAuth2 client
test('TC-056: Create OAuth2 client with credentials', () => {
  const client = googleOAuthClient(googleConfig);

  assert.ok(client);
  assert.equal(
    client.credentials.refresh_token,
    'test-refresh-token'
  );
});

// TC-057: Reject missing Calendar ID
test('TC-057: Disable Calendar client without Calendar ID', () => {
  const result = createCalendarClient({
    ...googleConfig,
    calendarId: '',
  });

  assert.equal(result, null);
});

// TC-058: Initialize Calendar API methods
test('TC-058: Initialize Calendar client methods', () => {
  const client = createCalendarClient(googleConfig);

  assert.ok(client);
  assert.equal(typeof client.insert, 'function');
  assert.equal(typeof client.patch, 'function');
  assert.equal(typeof client.remove, 'function');
});

