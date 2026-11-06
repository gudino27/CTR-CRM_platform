/**
 * Checks an image against what each platform accepts and words the warnings users see.
 * The per-platform rules themselves live in settings.js (imageRules).
 */
import { imageRules } from '../settings.js';

const MB = 1024 * 1024;

const typeLabel = { 'image/jpeg': 'JPEG', 'image/png': 'PNG', 'image/webp': 'WebP' };
const label = (mimeType) => typeLabel[mimeType] ?? mimeType ?? 'unknown type';
const ratio = (value) => (value >= 1 ? `${value.toFixed(2)}:1` : `1:${(1 / value).toFixed(2)}`);
/** " (4:5)" for a shape that is a small whole-number ratio (width:height up to 20), otherwise "". */
function simpleRatio(value) {
  for (let height = 1; height <= 20; height += 1) {
    const width = Math.round(value * height);
    if (width > 0 && Math.abs(width / height - value) < 0.001) return ` (${width}:${height})`;
  }
  return '';
}
const megabytes = (bytes) => `${(bytes / MB).toFixed(1)} MB`;

/**
 * Says whether a stored image suits a platform, with a plain-language warning for each rule
 * it breaks. Warnings are advice only: the upload is kept either way.
 *
 * Usage:
 *   const { ok, warnings } = checkImage(media, platform.name);   // GET /api/media/:id/check
 *
 * Takes:
 *   media        - a media row: { mimeType, width, height, sizeBytes } (width/height may be null)
 *   platformName - the platform's name as stored in platform.name, e.g. 'Instagram'
 *
 * Returns:
 *   { ok: boolean, warnings: string[] }; ok is true when there are no warnings.
 *   A platform with no entry in settings.js imageRules always returns { ok: true, warnings: [] }.
 *
 * How it works:
 *   1. Looks up the platform's rules.
 *   2. Checks the file type, the file size, the minimum width.
 *   3. When width and height are known, checks the shape (width / height) against minAspect
 *      and maxAspect, with a 0.005 tolerance so 1080x1350 (exactly 4:5) and 1.91:1 crops pass.
 *      When they are unknown and the platform has size or shape rules, adds one warning saying
 *      the dimensions could not be checked.
 *
 * When editing:
 *   The client shows these strings as they are (Compose, Library, Media page), so their
 *   wording is what users read. The portrait warning's "(4:5)" is built from minAspect; if minAspect for
 *   Instagram changes in settings.js, update that text too.
 */
export function checkImage(media, platformName) {
  const rules = imageRules[platformName];
  const warnings = [];
  if (!rules) return { ok: true, warnings };
  const { mimeType, width, height, sizeBytes } = media;
  if (!rules.mimeTypes.includes(mimeType)) {
    warnings.push(`${platformName} accepts ${rules.mimeTypes.map(label).join(' or ')}, not ${label(mimeType)}. Convert the image first.`);
  }
  if (sizeBytes && sizeBytes > rules.maxBytes) {
    warnings.push(`${platformName} images must be ${megabytes(rules.maxBytes)} or smaller; this one is ${megabytes(sizeBytes)}.`);
  }
  if (rules.minWidth && width && width < rules.minWidth) {
    warnings.push(`${platformName} images should be at least ${rules.minWidth} px wide; this one is ${width} px.`);
  }
  if (width && height) {
    const aspect = width / height;
    // Small tolerance so exact 4:5 and 1.91:1 crops pass
    if (rules.minAspect && aspect < rules.minAspect - 0.005) {
      warnings.push(`${platformName} crops images taller than ${ratio(rules.minAspect)}${simpleRatio(rules.minAspect)}; this one is ${ratio(aspect)}.`);
    }
    if (rules.maxAspect && aspect > rules.maxAspect + 0.005) {
      warnings.push(`${platformName} crops images wider than ${ratio(rules.maxAspect)}; this one is ${ratio(aspect)}.`);
    }
  } else if (rules.minWidth || rules.minAspect || rules.maxAspect) {
    warnings.push('The image size is unknown, so its dimensions could not be checked.');
  }
  return { ok: warnings.length === 0, warnings };
}
