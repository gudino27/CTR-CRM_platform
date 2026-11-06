/**
 * Turns every upload into a JPEG, since all the platforms accept JPEG and the team never
 * posts transparency. JPEGs are kept byte for byte (no re-encode), except ones that rely on
 * an EXIF orientation tag to show the right way up.
 *
 * What lives here: toJpeg (uploads), rotateJpeg (the Rotate button), lowResJpeg (the small
 * copy kept for published posts) and jpegName (file names).
 * Quality, background color and small-copy size live in settings.js.
 */
import sharp from 'sharp';
import { jpegBackground, jpegOptions, smallCopyJpegOptions, smallCopyMaxPx } from '../settings.js';

/**
 * Gives the bytes to store for an upload: the JPEG as uploaded, or a new JPEG made from it.
 *
 * Usage:
 *   const jpeg = await toJpeg(original, imageInfo(original));   // routes/media.js, POST /api/media
 *
 * Takes:
 *   buffer - the uploaded bytes
 *   info   - imageInfo(buffer) of the upload: { mimeType, width, height }
 *
 * Returns:
 *   { buffer, mimeType: 'image/jpeg', width, height, converted, exifOrientation }
 *   converted       - false when the upload was kept byte for byte, true when re-encoded
 *   exifOrientation - the upload's EXIF orientation tag (1-8), or null when it has none
 *   Throws when sharp can't decode a PNG or WebP (the route answers 400).
 *
 * How it works:
 *   1. Reads the metadata. A JPEG whose header sharp can't read is stored as uploaded, as
 *      before EXIF was checked.
 *   2. A JPEG with no orientation tag (or tag 1, "already upright") is returned unchanged.
 *      A JPEG the camera stored sideways, where only the EXIF tag says which way is up, is
 *      re-saved upright, since not every platform reads the tag.
 *   3. Everything else: rotate() with no angle applies the EXIF orientation, flatten() puts
 *      transparent pixels on jpegBackground, then it is encoded with jpegOptions.
 *
 * When editing:
 *   The route stores the original's sha256 too, so a repeat upload of the same file is found
 *   even when it was converted. Changing jpegOptions only affects new uploads.
 */
export async function toJpeg(buffer, info) {
  const metadata = await sharp(buffer).metadata().catch((err) => {
    if (info.mimeType === 'image/jpeg') return {};
    throw err;
  });
  const exifOrientation = metadata.orientation ?? null;
  if (info.mimeType === 'image/jpeg' && (exifOrientation == null || exifOrientation === 1)) {
    return { buffer, mimeType: 'image/jpeg', width: info.width, height: info.height, converted: false, exifOrientation };
  }
  const { data, info: out } = await sharp(buffer)
    .rotate()
    .flatten({ background: jpegBackground })
    .jpeg(jpegOptions)
    .toBuffer({ resolveWithObject: true });
  return { buffer: data, mimeType: 'image/jpeg', width: out.width, height: out.height, converted: true, exifOrientation };
}

/**
 * Turns a stored JPEG clockwise and re-encodes it (the Rotate button on the Media page).
 *
 * Usage:
 *   const turned = await rotateJpeg(current, 90);   // routes/media.js, POST /api/media/:id/rotate
 *
 * Takes:
 *   buffer  - the stored JPEG's bytes
 *   degrees - 90, 180 or 270 (clockwise)
 *
 * Returns:
 *   { buffer, width, height } of the new JPEG.
 *
 * How it works:
 *   Applies any EXIF orientation first (autoOrient), so older uploads that still carry one
 *   turn the way they look; then rotates, flattens onto jpegBackground and encodes with
 *   jpegOptions.
 *
 * When editing:
 *   Each rotation re-encodes, so quality drops a little every time it is used.
 */
export async function rotateJpeg(buffer, degrees) {
  const { data, info } = await sharp(buffer)
    .autoOrient()
    .rotate(degrees)
    .flatten({ background: jpegBackground })
    .jpeg(jpegOptions)
    .toBuffer({ resolveWithObject: true });
  return { buffer: data, width: info.width, height: info.height };
}

/**
 * Makes the small JPEG kept for history once a published post's full image is cleaned up.
 *
 * Usage:
 *   lowRes = await lowResJpeg(source);   // services/mediaTrash.js
 *
 * Takes:
 *   buffer - the full image's bytes
 *
 * Returns:
 *   { buffer, width, height } of a JPEG at most smallCopyMaxPx (settings.js) on its longest side.
 *
 * How it works:
 *   Applies EXIF orientation, shrinks to fit inside smallCopyMaxPx x smallCopyMaxPx (never
 *   enlarges a smaller image), flattens onto jpegBackground and encodes with smallCopyJpegOptions.
 */
export async function lowResJpeg(buffer) {
  const { data, info } = await sharp(buffer)
    .autoOrient()
    .resize(smallCopyMaxPx, smallCopyMaxPx, { fit: 'inside', withoutEnlargement: true })
    .flatten({ background: jpegBackground })
    .jpeg(smallCopyJpegOptions)
    .toBuffer({ resolveWithObject: true });
  return { buffer: data, width: info.width, height: info.height };
}

/**
 * Gives a converted upload a .jpg name, so the Drive file name matches its type.
 *
 * Usage:
 *   jpegName('garden.png')   // -> 'garden.jpg'
 *
 * Takes:
 *   name - the uploaded file name
 *
 * Returns:
 *   The name with its last extension replaced by .jpg, or with .jpg added when it has none.
 */
export function jpegName(name) {
  return /\.[a-z0-9]+$/i.test(name) ? name.replace(/\.[a-z0-9]+$/i, '.jpg') : `${name}.jpg`;
}
