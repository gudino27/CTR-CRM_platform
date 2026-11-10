
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  imageInfo,
  extensions,
} from '../../src/services/imageInfo.js';

// Create sample image headers for testing.
// These are synthetic headers, not complete images.

function makePNG(width = 1080, height = 1350) {
  const buf = Buffer.alloc(24);
  Buffer.from([
    0x89, 0x50, 0x4e, 0x47,
    0x0d, 0x0a, 0x1a, 0x0a,
  ]).copy(buf);

  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

function makeJPEG(marker = 0xc0) {
  return Buffer.from([
    0xff, 0xd8,
    0xff, marker,
    0x00, 0x11,
    0x08,
    0x01, 0xe0,
    0x02, 0x80,
    0x03,
    0x01, 0x11, 0x00,
    0x02, 0x11, 0x01,
    0x03, 0x11, 0x01,
  ]);
}

function makeWebP(chunk) {
  const buf = Buffer.alloc(30);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(22, 4);
  buf.write('WEBP', 8, 'ascii');
  buf.write(chunk, 12, 'ascii');
  return buf;
}

// TC-035: Identify PNG images
test('TC-035: Identify PNG image', () => {
  assert.deepEqual(imageInfo(makePNG()), {
    mimeType: 'image/png',
    width: 1080,
    height: 1350,
  });
});

// TC-036: Identify baseline JPEG images
test('TC-036: Identify baseline JPEG', () => {
  assert.deepEqual(imageInfo(makeJPEG()), {
    mimeType: 'image/jpeg',
    width: 640,
    height: 480,
  });
});

// TC-037: Identify progressive JPEG images
test('TC-037: Identify progressive JPEG', () => {
  assert.deepEqual(imageInfo(makeJPEG(0xc2)), {
    mimeType: 'image/jpeg',
    width: 640,
    height: 480,
  });
});

// TC-038: Identify lossy WebP images
test('TC-038: Identify VP8 WebP image', () => {
  const buf = makeWebP('VP8 ');
  buf.writeUInt16LE(640, 26);
  buf.writeUInt16LE(480, 28);

  assert.deepEqual(imageInfo(buf), {
    mimeType: 'image/webp',
    width: 640,
    height: 480,
  });
});

// TC-039: Identify lossless WebP images
test('TC-039: Identify VP8L WebP image', () => {
  const buf = makeWebP('VP8L');
  const bits = ((479 << 14) | 639) >>> 0;
  buf.writeUInt32LE(bits, 21);

  assert.deepEqual(imageInfo(buf), {
    mimeType: 'image/webp',
    width: 640,
    height: 480,
  });
});

// TC-040: Identify extended WebP images
test('TC-040: Identify VP8X WebP image', () => {
  const buf = makeWebP('VP8X');
  buf.writeUIntLE(639, 24, 3);
  buf.writeUIntLE(479, 27, 3);

  assert.deepEqual(imageInfo(buf), {
    mimeType: 'image/webp',
    width: 640,
    height: 480,
  });
});

// TC-041: Reject invalid PNG headers
test('TC-041: Reject invalid PNG headers', () => {
  const truncated = makePNG().subarray(0, 15);

  const invalid = makePNG();
  invalid.write('ABCD', 12, 'ascii');

  assert.equal(imageInfo(truncated), null);
  assert.equal(imageInfo(invalid), null);
});

// TC-042: Handle JPEG metadata before dimensions
test('TC-042: Handle JPEG metadata segment', () => {
  const appSegment = Buffer.from([
    0xff, 0xd8,
    0xff, 0xe0,
    0x00, 0x04,
    0x11, 0x22,
  ]);

  const jpeg = Buffer.concat([
    appSegment,
    makeJPEG().subarray(2),
  ]);

  assert.deepEqual(imageInfo(jpeg), {
    mimeType: 'image/jpeg',
    width: 640,
    height: 480,
  });
});

// TC-043: Reject unsupported inputs
test('TC-043: Reject unsupported image data', () => {
  assert.equal(imageInfo(null), null);
  assert.equal(imageInfo('image'), null);
  assert.equal(imageInfo(Buffer.alloc(0)), null);
  assert.equal(
    imageInfo(Buffer.from('not an image')),
    null
  );
});

// TC-044: Validate image extensions
test('TC-044: Validate MIME type extensions', () => {
  assert.equal(extensions['image/png'], 'png');
  assert.equal(extensions['image/jpeg'], 'jpg');
  assert.equal(extensions['image/webp'], 'webp');
  assert.equal(extensions['image/gif'], undefined);
});

// TC-045: Reject incomplete JPEG headers
test('TC-045: Reject truncated JPEG header', () => {
  const truncated = Buffer.from([
    0xff, 0xd8,
    0xff, 0xc0,
    0x00, 0x11,
    0x08, 0x01,
  ]);

  assert.equal(imageInfo(truncated), null);
});
