/**
 * Image URL normalization and identity helpers for PLAN9.
 * Canonical URLs use the Bing image identity with supported suffixes.
 * ADR-0003: Canonical image cache keys
 */

const BING_CDN_ORIGIN = "https://ts1.tc.mm.bing.net";

// Supported resolution suffixes (canonical)
const SUFFIX_PREVIEW = "_640x360.jpg";
const SUFFIX_HD = "_1920x1080.jpg";
const SUFFIX_UHD = "_UHD.jpg";

// Known non-canonical suffix that normalizes to HD
const WEBP_HD_SUFFIX = "_1920x1080.webp";

const ALLOWED_IMAGE_HOSTS = new Set([
  "www.bing.com",
  "cn.bing.com",
  "ts1.tc.mm.bing.net"
]);

const IMAGE_ID_PATTERN = /^OHR\.[A-Za-z0-9-]+(?:_[A-Za-z0-9-]+)*$/;

// All known suffixes in order of length descending (so greedy strip works correctly)
const KNOWN_SUFFIXES = [
  SUFFIX_PREVIEW,
  SUFFIX_HD,
  SUFFIX_UHD,
  WEBP_HD_SUFFIX,
  // Without extension — urlbase form from Archive
  "_640x360",
  "_1920x1080",
  "_UHD",
];

function parseImageUrl(url) {
  if (typeof url !== 'string' || !url) {
    return null;
  }

  let parsed;
  try {
    if (url.startsWith('/') && !url.startsWith('//')) {
      parsed = new URL(url, 'https://www.bing.com');
    } else {
      parsed = new URL(url);
      if (parsed.protocol !== 'https:' || !ALLOWED_IMAGE_HOSTS.has(parsed.hostname) ||
          parsed.username || parsed.password || parsed.port) {
        return null;
      }
    }
  } catch {
    return null;
  }

  if (parsed.pathname !== '/th') {
    return null;
  }

  const idValue = parsed.searchParams.get('id');
  return idValue ? idValue : null;
}

export function isValidImageIdentity(imageId) {
  return typeof imageId === 'string' && IMAGE_ID_PATTERN.test(imageId) &&
    !/_\d+x\d+$/.test(imageId) && !/_UHD$/.test(imageId);
}

/**
 * Extract the OHR image identity from a URL or urlbase.
 * Parses the `id` query parameter, percent-decodes it, strips any known
 * resolution suffix, and returns the bare OHR identity.
 * Unknown suffixes cause the identity to be rejected (return null) so that
 * normalization never silently guesses a resolution.
 *
 * @param {string} url - URL or urlbase containing an OHR identity
 * @returns {string|null} The OHR identity (e.g. "OHR.ImageName_ZH-CN1234567890") or null
 */
export function extractImageId(url) {
  const idValue = parseImageUrl(url);
  if (!idValue) {
    return null;
  }

  // Strip any known suffix (including file extension)
  for (const suffix of KNOWN_SUFFIXES) {
    if (idValue.endsWith(suffix)) {
      const imageId = idValue.slice(0, -suffix.length);
      return isValidImageIdentity(imageId) ? imageId : null;
    }
  }

  // isValidImageIdentity also rejects unknown resolution suffixes.
  return isValidImageIdentity(idValue) ? idValue : null;
}

/**
 * Validate and normalize a resolution suffix.
 * Model uses _1920x1080.webp which normalizes to _1920x1080.jpg.
 * Unknown suffixes are rejected (null) rather than guessed.
 *
 * @param {string} suffix - The suffix to validate
 * @returns {string|null} Canonical suffix or null if unknown
 */
export function validateAndNormalizeSuffix(suffix) {
  if (typeof suffix !== 'string') {
    return null;
  }

  if (suffix === SUFFIX_PREVIEW || suffix === SUFFIX_HD || suffix === SUFFIX_UHD) {
    return suffix;
  }

  if (suffix === WEBP_HD_SUFFIX) {
    return SUFFIX_HD;
  }

  return null;
}

/**
 * Normalize an image URL to its canonical form.
 * Extracts and validates the OHR identity, then rebuilds the canonical URL
 * for the requested resolution.
 *
 * @param {string} url - Image URL from any source (IOTD, Model, Archive, legacy)
 * @param {'preview'|'hd'|'uhd'} resolution - Target resolution
 * @returns {string|null} Canonical URL or null if the URL is invalid
 */
export function normalizeImageUrl(url, resolution) {
  const imageId = extractImageId(url);
  if (!imageId) {
    return null;
  }

  let suffix;
  switch (resolution) {
    case 'preview': suffix = SUFFIX_PREVIEW; break;
    case 'hd':      suffix = SUFFIX_HD;      break;
    case 'uhd':     suffix = SUFFIX_UHD;     break;
    default: return null;
  }

  return `${BING_CDN_ORIGIN}/th?id=${imageId}${suffix}`;
}

/**
 * Build all three canonical URLs for an OHR image identity.
 * @param {string} imageId - The OHR image identity (must start with "OHR.")
 * @returns {{preview: string, highDef: string, ultraHighDef: string}}
 */
export function buildCanonicalUrls(imageId) {
  if (!isValidImageIdentity(imageId)) {
    throw new Error('Invalid image identity');
  }

  return {
    preview:      `${BING_CDN_ORIGIN}/th?id=${imageId}${SUFFIX_PREVIEW}`,
    highDef:      `${BING_CDN_ORIGIN}/th?id=${imageId}${SUFFIX_HD}`,
    ultraHighDef: `${BING_CDN_ORIGIN}/th?id=${imageId}${SUFFIX_UHD}`
  };
}

/**
 * Check if two image identities are the same.
 * @param {string} id1
 * @param {string} id2
 * @returns {boolean}
 */
export function isSameImage(id1, id2) {
  return typeof id1 === 'string' && typeof id2 === 'string' && id1 === id2;
}
