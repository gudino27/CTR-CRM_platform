
import test from 'node:test';
import assert from 'node:assert/strict';


import { checkImage } from '../../src/services/imageRules.js';
import { imageRules } from '../../src/settings.js';


const MB = 1024 * 1024;

const validImage = {
  mimeType: 'image/jpeg',
  width: 1080,
  height: 1080,
  sizeBytes: 2 * MB,
};

// TC-024: Accept valid Instagram images
test('TC-024: Accept valid Instagram image', () => {
  const result = checkImage(validImage, 'Instagram');

  assert.equal(result.ok, true);
  assert.deepEqual(result.warnings, []);
});

// TC-025: Reject unsupported Instagram formats
test('TC-025: Detect unsupported Instagram format', () => {
  const image = {
    ...validImage,
    mimeType: 'image/png',
  };

  const result = checkImage(image, 'Instagram');

  assert.equal(result.ok, false);
  assert.match(result.warnings[0], /JPEG/);
});

// TC-026: Validate Instagram file size
test('TC-026: Detect oversized Instagram image', () => {
  const image = {
    ...validImage,
    sizeBytes: 9 * MB,
  };

  const result = checkImage(image, 'Instagram');

  assert.equal(result.ok, false);
  assert.match(result.warnings[0], /8.0 MB/);
});

// TC-027: Validate Instagram minimum width
test('TC-027: Detect image below minimum width', () => {
  const image = {
    ...validImage,
    width: 300,
    height: 300,
  };

  const result = checkImage(image, 'Instagram');

  assert.equal(result.ok, false);
  assert.match(result.warnings[0], /320 px/);
});

// TC-028: Detect excessively tall images
test('TC-028: Detect invalid portrait ratio', () => {
  const image = {
    ...validImage,
    width: 600,
    height: 1000,
  };

  const result = checkImage(image, 'Instagram');

  assert.equal(result.ok, false);
  assert.ok(
    result.warnings.some(w => w.includes('taller'))
  );
});

// TC-029: Detect excessively wide images
test('TC-029: Detect invalid landscape ratio', () => {
  const image = {
    ...validImage,
    width: 2000,
    height: 800,
  };

  const result = checkImage(image, 'Instagram');

  assert.equal(result.ok, false);
  assert.ok(
    result.warnings.some(w => w.includes('wider'))
  );
});

// TC-030: Accept Instagram aspect ratio boundaries
test('TC-030: Accept valid aspect ratio boundaries', () => {
  const portrait = {
    ...validImage,
    width: 1080,
    height: 1350,
  };

  const landscape = {
    ...validImage,
    width: 1910,
    height: 1000,
  };

  assert.equal(checkImage(portrait, 'Instagram').ok, true);
  assert.equal(checkImage(landscape, 'Instagram').ok, true);
});

// TC-031: Validate Facebook image formats
test('TC-031: Validate Facebook image formats', () => {
  const png = {
    ...validImage,
    mimeType: 'image/png',
  };

  const webp = {
    ...validImage,
    mimeType: 'image/webp',
  };

  assert.equal(checkImage(png, 'Facebook').ok, true);
  assert.equal(checkImage(webp, 'Facebook').ok, false);
});

// TC-032: Validate LinkedIn image restrictions
test('TC-032: Validate LinkedIn image limits', () => {
  const image = {
    ...validImage,
    width: 500,
    height: 500,
    sizeBytes: 6 * MB,
  };

  const result = checkImage(image, 'LinkedIn');

  assert.equal(result.ok, false);
  assert.equal(result.warnings.length, 2);
});

// TC-033: Validate Test platform image support
test('TC-033: Validate Test platform image rules', () => {
  const image = {
    mimeType: 'image/webp',
    width: 100,
    height: 100,
    sizeBytes: 9 * MB,
  };

  assert.equal(checkImage(image, 'Test').ok, true);

  const oversized = {
    ...image,
    sizeBytes: 11 * MB,
  };

  assert.equal(checkImage(oversized, 'Test').ok, false);
});

// TC-034: Handle missing image dimensions
test('TC-034: Warn when image dimensions are unknown', () => {
  const image = {
    mimeType: 'image/jpeg',
    sizeBytes: 2 * MB,
  };

  const result = checkImage(image, 'Instagram');

  assert.equal(result.ok, false);
  assert.ok(
    result.warnings.some(w => w.includes('unknown'))
  );
});
