/**
 * Image URL normalization and identity helpers for PLAN9.
 * Canonical URLs use the Bing image identity with supported suffixes.
 * ADR-0003: Canonical image cache keys
 */

const BING_CDN_ORIGIN = "https://ts1.tc.mm.bing.net";

// Supported resolution suffixes
const SUFFIX_PREVIEW = "_640x360.jpg";
const SUFFIX_HD = "_1920x1080.jpg";
const SUFFIX_UHD = "_UHD.jpg";

// Known suffixes that need normalization (webp -> jpg)
const WEBP_HD_SUFFIX = "_1920x1080.webp";

/**
 * Extract the OHR image identity from a URL or urlbase.
 * @param {string} url - URL or urlbase containing an OHR identity
 * @returns {string|null} The OHR identity (e.g., "OHR.ImageName_ZH-CN1234567890") or null if invalid
 */
export function extractImageId(url) {
  if (typeof url !== 'string') {
    return null;
  }

  // Match the id parameter value
  const idMatch = url.match(/[?&]?id=([^&]+)/);
  if (idMatch) {
    url = idMatch[1];
  }

  // Match OHR.* pattern - capture everything after OHR. including multiple underscores
  const ohrMatch = url.match(/OHR\.[A-Za-z0-9_-]+/);

  if (!ohrMatch) {
    return null;
  }

  let identity = ohrMatch[0];

  // Remove known resolution suffixes and file extensions
  // Handle cases like _1920x1080.jpg, _1920x1080.webp, _640x360.jpg, _UHD.jpg
  identity = identity.replace(/_\d+x\d+\.(jpg|webp)$/, '');
  identity = identity.replace(/_UHD\.jpg$/, '');
  identity = identity.replace(/_\d+x\d+$/, '');
  identity = identity.replace(/_UHD$/, '');

  return identity;
}

/**
 * Validate and normalize a resolution suffix.
 * Model uses _1920x1080.webp which normalizes to _1920x1080.jpg.
 * Unknown suffixes are rejected.
 *
 * @param {string} suffix - The suffix to validate (e.g., "_1920x1080.jpg", "_1920x1080.webp")
 * @returns {string|null} Canonical suffix or null if invalid/unknown
 */
export function validateAndNormalizeSuffix(suffix) {
  if (typeof suffix !== 'string') {
    return null;
  }

  // Direct match for supported suffixes
  if (suffix === SUFFIX_PREVIEW || suffix === SUFFIX_HD || suffix === SUFFIX_UHD) {
    return suffix;
  }

  // Normalize webp to jpg for HD
  if (suffix === WEBP_HD_SUFFIX) {
    return SUFFIX_HD;
  }

  // Unknown suffix - reject rather than guess
  return null;
}

/**
 * Normalize an image URL to its canonical form.
 * Extracts the full OHR identity, validates the suffix, and rebuilds the canonical URL.
 *
 * @param {string} url - Image URL from any source (IOTD, Model, Archive, legacy)
 * @param {'preview'|'hd'|'uhd'} resolution - Target resolution
 * @returns {string|null} Canonical URL or null if the URL is invalid
 */
export function normalizeImageUrl(url, resolution) {
  if (typeof url !== 'string' || !url) {
    return null;
  }

  // Extract the image identity
  const imageId = extractImageId(url);
  if (!imageId) {
    return null;
  }

  // Determine the canonical suffix
  let suffix;
  switch (resolution) {
    case 'preview':
      suffix = SUFFIX_PREVIEW;
      break;
    case 'hd':
      suffix = SUFFIX_HD;
      break;
    case 'uhd':
      suffix = SUFFIX_UHD;
      break;
    default:
      return null;
  }

  // Build canonical URL: origin + /th?id= + identity + suffix
  return `${BING_CDN_ORIGIN}/th?id=${imageId}${suffix}`;
}

/**
 * Build all canonical URLs for an image identity.
 * @param {string} imageId - The OHR image identity
 * @returns {{preview: string, highDef: string, ultraHighDef: string}}
 */
export function buildCanonicalUrls(imageId) {
  if (typeof imageId !== 'string' || !imageId.startsWith('OHR.')) {
    throw new Error('Invalid image identity');
  }

  return {
    preview: `${BING_CDN_ORIGIN}/th?id=${imageId}${SUFFIX_PREVIEW}`,
    highDef: `${BING_CDN_ORIGIN}/th?id=${imageId}${SUFFIX_HD}`,
    ultraHighDef: `${BING_CDN_ORIGIN}/th?id=${imageId}${SUFFIX_UHD}`
  };
}

/**
 * Check if two image identities are the same.
 * @param {string} id1 - First image ID
 * @param {string} id2 - Second image ID
 * @returns {boolean}
 */
export function isSameImage(id1, id2) {
  return typeof id1 === 'string' && typeof id2 === 'string' && id1 === id2;
}
