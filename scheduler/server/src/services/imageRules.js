const MB = 1024 * 1024;
export const imageRules = {
  Instagram: {
    mimeTypes: ['image/jpeg'],
    maxBytes: 8 * MB,
    minWidth: 320,
    minAspect: 4 / 5,   // 0.8, portrait limit
    maxAspect: 1.91,    // landscape limit
  },
  Facebook: {
    mimeTypes: ['image/jpeg', 'image/png'],
    maxBytes: 4 * MB,
    minWidth: 600,
    minAspect: null,
    maxAspect: null,
  },
  LinkedIn: {
    mimeTypes: ['image/jpeg', 'image/png'],
    maxBytes: 5 * MB,
    minWidth: 552,
    minAspect: null,
    maxAspect: null,
  },
  Test: {
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    maxBytes: 10 * MB, // the upload route's own limit
    minWidth: null,
    minAspect: null,
    maxAspect: null,
  },
};

const typeLabel = { 'image/jpeg': 'JPEG', 'image/png': 'PNG', 'image/webp': 'WebP' };
const label = (mimeType) => typeLabel[mimeType] ?? mimeType ?? 'unknown type';
const ratio = (value) => (value >= 1 ? `${value.toFixed(2)}:1` : `1:${(1 / value).toFixed(2)}`);
const megabytes = (bytes) => `${(bytes / MB).toFixed(1)} MB`;
/** { ok, warnings } for a media row on a platform; platforms without rules always pass. */
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
    // Small tolerance so 1080x1350 (exactly 4:5) and 1.91:1 crops pass
    if (rules.minAspect && aspect < rules.minAspect - 0.005) {
      warnings.push(`${platformName} crops images taller than ${ratio(rules.minAspect)} (4:5); this one is ${ratio(aspect)}.`);
    }
    if (rules.maxAspect && aspect > rules.maxAspect + 0.005) {
      warnings.push(`${platformName} crops images wider than ${ratio(rules.maxAspect)}; this one is ${ratio(aspect)}.`);
    }
  } else if (rules.minWidth || rules.minAspect || rules.maxAspect) {
    warnings.push('The image size is unknown, so its dimensions could not be checked.');
  }
  return { ok: warnings.length === 0, warnings };
}