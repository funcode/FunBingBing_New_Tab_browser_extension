/**
 * Metadata stage and merge helpers for PLAN9.
 * Metadata stages are monotonic: iotd > media > preload > archive > legacy
 */

import { addDays, isValidCalendarDate } from './date.js';
import { extractImageId, isValidImageIdentity } from './image.js';

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

  const merged = {
    ...lower,
    ...higher,
    metadataStage: candidateIsHigher ? candidateStage : currentStage
  };

  // A higher-stage response can contain an empty field while a lower-stage
  // response still has the useful value needed for display.
  for (const [key, value] of Object.entries(lower)) {
    if ((merged[key] === undefined || merged[key] === null || merged[key] === '') &&
        value !== undefined && value !== null && value !== '') {
      merged[key] = value;
    }
  }

  const previousTriviaId = current.triviaId || '';
  const nextTriviaId = merged.triviaId || '';
  if (previousTriviaId !== nextTriviaId) {
    return {
      ...merged,
      triviaData: null,
      triviaState: 'missing',
      triviaAttemptedAt: 0,
      triviaNextRetryAt: 0,
      triviaRetryLevel: 0
    };
  }

  return {
    ...merged,
    // Trivia retry state is always taken from current (the persisted side)
    triviaData: current.triviaData !== undefined ? current.triviaData : (candidate.triviaData ?? null),
    triviaState: current.triviaState || candidate.triviaState || 'missing',
    triviaAttemptedAt: current.triviaAttemptedAt ?? 0,
    triviaNextRetryAt: current.triviaNextRetryAt ?? 0,
    triviaRetryLevel: current.triviaRetryLevel ?? 0
  };
}

/**
 * Validate source coverage.
 * - IOTD: response.data.images contains a valid entry for targetDate
 * - Model: MediaContents contains a valid entry with Ssd equal to targetDate
 * - Archive: the catalog contains the complete consecutive IOTD window and
 *   the response contains the oldest day's entry matching that catalog identity
 *
 * @param {string} source - Source name ('imageOfTheDay', 'model', 'archive')
 * @param {Object} response - Source response data
 * @param {string} targetDate - Expected target date in YYYYMMDD format
 * @param {Object} [catalog] - IOTD catalog, required for archive
 * @returns {boolean}
 */
export function validateSourceCoverage(source, response, targetDate, catalog) {
  if (!response || !isValidCalendarDate(targetDate)) {
    return false;
  }

  switch (source) {
    case 'imageOfTheDay': {
      const images = response.data && response.data.images;
      if (!Array.isArray(images) || images.length === 0) {
        return false;
      }
      return images.some(image => {
        if (!image || image.isoDate !== targetDate) {
          return false;
        }
        const landscapeUrls = image.imageUrls?.landscape;
        return extractImageId(landscapeUrls?.highDef || landscapeUrls?.ultraHighDef) !== null;
      });
    }

    case 'model': {
      if (!response.MediaContents || !Array.isArray(response.MediaContents)) {
        return false;
      }
      return response.MediaContents.some(media => {
        if (!media || media.Ssd !== targetDate) {
          return false;
        }
        return extractImageId(media.ImageContent?.Image?.Url) !== null;
      });
    }

    case 'archive': {
      if (!response.images || !Array.isArray(response.images) || response.images.length === 0) {
        return false;
      }
      const entries = catalog && catalog.entries;
      if (!entries || typeof entries !== 'object') {
        return false;
      }

      const expectedDates = [];
      for (let i = 0; i < 8; i++) {
        expectedDates.push(addDays(targetDate, -i));
      }

      for (const date of expectedDates) {
        const entry = entries[date];
        if (!entry || entry.metadataStage !== 'iotd' || !isValidImageIdentity(entry.imageId)) {
          return false;
        }
      }

      const oldestDate = expectedDates[expectedDates.length - 1];
      const oldestImage = response.images.find(image => image?.enddate === oldestDate);
      if (!oldestImage) {
        return false;
      }

      // Catalog identities were validated above, so a null extraction never matches.
      return extractImageId(oldestImage.urlbase || oldestImage.url) === entries[oldestDate].imageId;
    }

    default:
      return false;
  }
}
