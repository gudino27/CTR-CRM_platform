
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  testEndpointUrl,
  webhookUrlFor,
  buildPayload,
  payloadProblems,
} from '../../src/services/dispatch.js';

import { config } from '../../src/config.js';

const platform = {
  key: 'instagram',
  name: 'Instagram',
  isTest: false,
  webhookUrl: 'https://example.invalid/publish',
};

const post = {
  id: 123,
  caption: 'Test social media post',
  hashtags: '#CTR #Nonprofit',
  altText: 'A group of volunteers',
  scheduledAt: '2026-11-09T18:00:00.000Z',
  kind: 'library',
  postTypeName: 'Newsletter',
  color: 'Blue',
};

const media = {
  driveFileId: 'test-drive-file',
  link: '/media/test-image.jpg',
  mimeType: 'image/jpeg',
};

const createPayload = (overrides = {}) =>
  buildPayload({
    post,
    platform,
    media,
    ...overrides,
  });

// TC-059: Test webhook URL
test('TC-059: Generate test webhook URL', () => {
  assert.equal(
    testEndpointUrl(),
    `${config.selfUrl}/api/test-webhook`
  );
});

// TC-060: Test platform routing
test('TC-060: Route Test platform safely', () => {
  const result = webhookUrlFor({
    ...platform,
    isTest: true,
  });

  assert.equal(result, testEndpointUrl());
});

// TC-061: Verify webhook routing
test('TC-061: Select correct webhook destination', () => {
  const result = webhookUrlFor(platform);

  const expected = config.testMode
    ? config.webhook.testUrl || testEndpointUrl()
    : platform.webhookUrl;

  assert.equal(result, expected);
});

// TC-062: Validate post payload
test('TC-062: Build correct publishing payload', () => {
  const payload = createPayload();

  assert.equal(payload.postId, '123');
  assert.equal(payload.platform, 'instagram');
  assert.equal(payload.platformName, 'Instagram');
  assert.equal(payload.kind, 'library');
  assert.equal(payload.postType, 'Newsletter');
  assert.equal(payload.color, 'Blue');
  assert.equal(payload.createdBy, null);

  assert.equal(
    payload.caption,
    'Test social media post\n\n#CTR #Nonprofit'
  );

  assert.equal(
    payload.callbackUrl,
    `${config.appUrl}/api/posts/123/status`
  );

  assert.match(
    payload.scheduledFor,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/
  );
});

// TC-063: Validate media information
test('TC-063: Include image information', () => {
  const payload = createPayload();

  assert.equal(payload.media.length, 1);

  assert.deepEqual(payload.media[0], {
    type: 'image',
    driveFileId: 'test-drive-file',
    url: `${config.appUrl}/media/test-image.jpg`,
    mimeType: 'image/jpeg',
    altText: 'A group of volunteers',
  });
});

// TC-064: Handle posts without media
test('TC-064: Handle missing media safely', () => {
  const payload = createPayload({
    media: null,
  });

  assert.deepEqual(payload.media, []);
});

// TC-065: Accept valid payloads
test('TC-065: Accept valid publishing payload', () => {
  const payload = createPayload();

  assert.deepEqual(payloadProblems(payload), []);
});

// TC-066: Reject invalid required fields
test('TC-066: Reject missing required fields', () => {
  const payload = {
    ...createPayload(),
    postId: '',
    platform: '',
    caption: '',
  };

  const problems = payloadProblems(payload);

  assert.ok(problems.includes(
    'postId must be a non-empty string'
  ));

  assert.ok(problems.includes(
    'platform must be a non-empty string'
  ));

  assert.ok(problems.includes(
    'caption must be a non-empty string'
  ));
});

// TC-067: Reject invalid scheduling data
test('TC-067: Reject invalid scheduling fields', () => {
  const payload = {
    ...createPayload(),
    scheduledFor: '2026-11-09T13:00:00Z',
    kind: 'invalid',
    postType: '',
    color: 42,
  };

  const problems = payloadProblems(payload);

  assert.ok(problems.some(
    p => p.includes('scheduledFor')
  ));

  assert.ok(problems.some(
    p => p.includes('kind must be')
  ));

  assert.ok(problems.some(
    p => p.includes('postType')
  ));

  assert.ok(problems.some(
    p => p.includes('color')
  ));
});

// TC-068: Reject invalid media data
test('TC-068: Reject invalid media payload', () => {
  const payload = {
    ...createPayload(),
    media: [{
      type: 'video',
      url: '',
      mimeType: '',
      altText: null,
    }],
  };

  const problems = payloadProblems(payload);

  assert.equal(problems.length, 4);
});
