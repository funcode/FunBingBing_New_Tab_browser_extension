/**
 * Metadata stage and merge helpers for PLAN9.
 * Metadata stages are monotonic: iotd > media > preload > archive > legacy
 */

import { addDays } from './date.js';

const METADATA_STAGES = {
  legacy: 0,
  archive: 1,
  preload: 2,
  media: 3,
  iotd: 4
};

/**
 * Compare two metadata stages.
 * @param {string} stage1 - First stage
 * @param {string} stage2 - Second stage
 * @returns {number} -1 if stage1 < stage2, 0 if equal, 1 if stage1 > stage2
 */
export function compareMetadataStages(stage1, stage2) {
  const level1 = METADATA_STAGES[stage1] ?? -1;
  const level2 = METADATA_STAGES[stage2] ?? -1;

  if (level1 < level2) return -1;
  if (level1 > level2) return 1;
  return 0;
}

/**
 * Check if a metadata stage can replace another stage.
 * Higher stages can replace lower stages.
 *
 * @param {string} newStage - New metadata stage
 * @param {string} currentStage - Current metadata stage
 * @returns {boolean}
 */
export function canReplaceMetadataStage(newStage, currentStage) {
  return compareMetadataStages(newStage, currentStage) > 0;
}

/**
 * Merge metadata from two sources if they have the same date and imageId.
 * Higher stage wins for conflicting fields; lower-stage source-specific fields
 * (e.g. quickFact, triviaId from Archive) are preserved regardless of order.
 *
 * @param {Object} current - Current entry
 * @param {Object} candidate - Candidate entry from new source
 * @returns {Object|null} Merged entry or null if identities don't match
 */
export function mergeMetadata(current, candidate) {
  // Identity must match exactly
  if (current.date !== candidate.date || current.imageId !== candidate.imageId) {
    return null;
  }

  const currentStage = current.metadataStage || 'legacy';
  const candidateStage = candidate.metadataStage || 'legacy';
  const candidateIsHigher = compareMetadataStages(candidateStage, currentStage) > 0;

  // Higher stage takes precedence for shared fields, but never discards
  // source-specific fields contributed by lower stages.
  const [higher, lower] = candidateIsHigher
    ? [candidate, current]
    : [current, candidate];

  return {
    // Lower-stage fields first (as baseline), then higher-stage fields overwrite
    ...lower,
    ...higher,
    metadataStage: candidateIsHigher ? candidateStage : currentStage,
    // Source-specific enrichment fields: keep any non-empty value from either source
    quickFact: higher.quickFact || lower.quickFact || '',
    triviaId: higher.triviaId || lower.triviaId || '',
    backstageUrl: higher.backstageUrl || lower.backstageUrl || '',
    // Trivia retry state is always taken from current (the persisted side)
    triviaData: current.triviaData !== undefined ? current.triviaData : candidate.triviaData,
    triviaState: current.triviaState || candidate.triviaState || 'missing',
    triviaAttemptedAt: current.triviaAttemptedAt,
    triviaNextRetryAt: current.triviaNextRetryAt,
    triviaRetryLevel: current.triviaRetryLevel
  };
}

/**
 * Validate source coverage.
 * - IOTD: response.images[0].isoDate must equal targetDate (uses actual IOTD fixture shape)
 * - Model: MediaContents entry with Ssd equal to targetDate must exist
 * - Archive: exactly 8 consecutive entries from targetDate through targetDate-7;
 *   enddate equals targetDate-7; each entry's imageId must be non-empty;
 *   matching uses date and imageId, never array position
 *
 * @param {string} source - Source name ('imageOfTheDay', 'model', 'archive')
 * @param {Object} response - Source response data
 * @param {string} targetDate - Expected target date in YYYYMMDD format
 * @param {string} [targetImageId] - Required for archive: the IOTD imageId for targetDate
 * @returns {boolean}
 */
export function validateSourceCoverage(source, response, targetDate, targetImageId) {
  if (!response || !targetDate) {
    return false;
  }

  switch (source) {
    case 'imageOfTheDay': {
      // IOTD fixture uses response.images[]; the first entry's isoDate must equal targetDate
      if (!response.images || !Array.isArray(response.images) || response.images.length === 0) {
        return false;
      }
      return response.images[0].isoDate === targetDate;
    }

    case 'model': {
      // Model MediaContents.Ssd must equal targetDate
      if (!response.MediaContents || !Array.isArray(response.MediaContents)) {
        return false;
      }
      return response.MediaContents.some(mc => mc.Ssd === targetDate);
    }

    case 'archive': {
      // Archive must have exactly 8 entries
      if (!response.images || !Array.isArray(response.images) || response.images.length !== 8) {
        return false;
      }

      // enddate must equal targetDate - 7 days (oldest entry date)
      const oldestDate = addDays(targetDate, -7);
      if (response.enddate !== oldestDate) {
        return false;
      }

      // Build expected date set; matching uses date, not array position
      const expectedDates = new Set();
      for (let i = 0; i < 8; i++) {
        expectedDates.add(addDays(targetDate, -i));
      }

      // Build a map of date -> imageId from the response
      const dateToImageId = new Map();
      for (const img of response.images) {
        if (!img.startdate || !img.imageId) {
          return false; // Each entry must have a date and identity
        }
        dateToImageId.set(img.startdate, img.imageId);
      }

      // All 8 expected dates must be present
      for (const expected of expectedDates) {
        if (!dateToImageId.has(expected)) {
          return false;
        }
      }

      // If a target imageId is provided, it must match the archive entry for targetDate
      if (targetImageId !== undefined) {
        if (dateToImageId.get(targetDate) !== targetImageId) {
          return false;
        }
      }

      return true;
    }

    default:
      return false;
  }
}
