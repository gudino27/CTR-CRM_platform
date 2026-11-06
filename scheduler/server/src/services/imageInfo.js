/**
 * Identifies an image from its bytes (the Content-Type header is not trusted) and reads its
 * dimensions. Supports JPEG, PNG and WebP.
 *
 * What lives here: imageInfo (the entry point), extensions (file extension per type), and one
 * small reader per format (png, jpeg, webp).
 */

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// Start-of-frame markers that carry the image size (baseline, extended, progressive)
const JPEG_SOF = new Set([0xc0, 0xc1, 0xc2]);

/**
 * Reads a PNG's size from its IHDR chunk.
 *
 * Takes:
 *   buf - the file's bytes (Buffer)
 *
 * Returns:
 *   { mimeType: 'image/png', width, height }, or null when buf is not a PNG.
 *
 * How it works:
 *   Checks the 8-byte PNG signature and that the first chunk is IHDR, then reads width and
 *   height as big-endian 32-bit numbers at bytes 16 and 20.
 */
function png(buf) {
  if (buf.length < 24 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  if (buf.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { mimeType: 'image/png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/**
 * Reads a JPEG's size from its first start-of-frame marker.
 *
 * Takes:
 *   buf - the file's bytes (Buffer)
 *
 * Returns:
 *   { mimeType: 'image/jpeg', width, height }, or null when buf is not a JPEG or no
 *   start-of-frame marker is found.
 *
 * How it works:
 *   Checks the FF D8 start bytes, then walks the markers one by one: skips fill bytes and the
 *   markers that have no length field, stops at a start-of-frame marker (baseline, extended or
 *   progressive) and reads height then width from it; any other marker is skipped by its length.
 *
 * When editing:
 *   The height comes before the width in the frame header (bytes +5 and +7); that is the
 *   JPEG layout, not a mistake.
 */
function jpeg(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    // Fill bytes and markers without a length field
    if (marker === 0xff) { i += 1; continue; }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const length = buf.readUInt16BE(i + 2);
    if (JPEG_SOF.has(marker)) {
      if (i + 9 > buf.length) return null;
      return { mimeType: 'image/jpeg', width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
    }
    i += 2 + length;
  }
  return null;
}

/**
 * Reads a WebP's size from its first chunk.
 *
 * Takes:
 *   buf - the file's bytes (Buffer)
 *
 * Returns:
 *   { mimeType: 'image/webp', width, height }, or null when buf is not a WebP or uses an
 *   unknown chunk.
 *
 * How it works:
 *   Checks the RIFF....WEBP header, then reads the size the way each WebP flavor stores it:
 *   'VP8 ' (lossy) as two 14-bit numbers, 'VP8L' (lossless) packed into one 32-bit number,
 *   'VP8X' (extended) as two 24-bit numbers. VP8L and VP8X store the size minus one.
 */
function webp(buf) {
  if (buf.length < 30 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return null;
  const chunk = buf.toString('ascii', 12, 16);
  if (chunk === 'VP8 ') {
    return { mimeType: 'image/webp', width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    const bits = buf.readUInt32LE(21);
    return { mimeType: 'image/webp', width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') {
    return { mimeType: 'image/webp', width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
  }
  return null;
}

/**
 * Tells what kind of image a file is from its bytes, and how big it is. The upload route uses
 * it to refuse files that are not images, whatever their Content-Type says.
 *
 * Usage:
 *   const info = imageInfo(original);   // routes/media.js, POST /api/media
 *
 * Takes:
 *   buf - the uploaded bytes (Buffer); anything else returns null
 *
 * Returns:
 *   { mimeType, width, height } for a PNG, JPEG or WebP, otherwise null.
 *
 * How it works:
 *   Tries the PNG reader, then JPEG, then WebP, and returns the first match.
 *
 * When editing:
 *   To accept a new format, add a reader here, an entry in extensions below, and a label in
 *   services/imageRules.js; imageConvert.js must also be able to turn it into a JPEG, and the
 *   upload route's "Only JPEG, PNG and WebP" message (routes/media.js) names the formats.
 */
export function imageInfo(buf) {
  if (!Buffer.isBuffer(buf)) return null;
  return png(buf) ?? jpeg(buf) ?? webp(buf);
}

// File extension per type, used for stored file names and default upload names
export const extensions = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
