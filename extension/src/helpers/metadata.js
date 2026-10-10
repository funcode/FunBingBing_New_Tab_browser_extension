/**
 * Metadata stage and merge helpers for PLAN9.
 * Metadata stages are monotonic: iotd > media > preload > archive > legacy
 */

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
 * Higher stage metadata wins for conflicting fields.
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

  // Higher stage wins
  if (compareMetadataStages(candidateStage, currentStage) <= 0) {
    // Candidate is not higher, keep current
    return current;
  }

  // Merge with candidate's higher-stage data taking precedence
  return {
    ...current,
    ...candidate,
    metadataStage: candidateStage,
    // Preserve trivia state from current if candidate doesn't provide better data
    triviaId: candidate.triviaId || current.triviaId,
    triviaData: candidate.triviaData !== undefined ? candidate.triviaData : current.triviaData,
    triviaState: candidate.triviaState || current.triviaState,
    triviaAttemptedAt: current.triviaAttemptedAt,
    triviaNextRetryAt: current.triviaNextRetryAt,
    triviaRetryLevel: current.triviaRetryLevel
  };
}

/**
 * Validate source coverage.
 * - IOTD: must cover the target date
 * - Model: MediaContents.Ssd must equal targetDate
 * - Archive: must have eight consecutive IOTD entries from targetDate through targetDate - 7 days
 *
 * @param {string} source - Source name ('imageOfTheDay', 'model', 'archive')
 * @param {Object} response - Source response data
 * @param {string} targetDate - Expected target date in YYYYMMDD format
 * @returns {boolean}
 */
export function validateSourceCoverage(source, response, targetDate) {
  if (!response || !targetDate) {
    return false;
  }

  switch (source) {
    case 'imageOfTheDay':
      // IOTD must have an image with isoDate matching targetDate
      if (!response.images || !Array.isArray(response.images)) {
        return false;
      }
      return response.images.some(img => img.isoDate === targetDate);

    case 'model':
      // Model MediaContents.Ssd must equal targetDate
      if (!response.MediaContents || !Array.isArray(response.MediaContents)) {
        return false;
      }
      return response.MediaContents.some(mc => mc.Ssd === targetDate);

    case 'archive':
      // Archive must have exactly 8 consecutive entries covering targetDate through targetDate - 7
      if (!response.images || !Array.isArray(response.images) || response.images.length !== 8) {
        return false;
      }

      // Response enddate must equal the oldest entry date (targetDate - 7 days)
      const oldestDate = addDays(targetDate, -7);
      if (response.enddate !== oldestDate) {
        return false;
      }

      // Check all 8 dates are present and consecutive
      const expectedDates = new Set();
      for (let i = 0; i < 8; i++) {
        expectedDates.add(addDays(targetDate, -i));
      }

      const actualDates = new Set(response.images.map(img => img.startdate));
      if (actualDates.size !== 8) {
        return false;
      }

      for (const expected of expectedDates) {
        if (!actualDates.has(expected)) {
          return false;
        }
      }

      return true;

    default:
      return false;
  }
}

/**
 * Add days to a YYYYMMDD date (helper for archive validation).
 * @param {string} dateStr - Date in YYYYMMDD format
 * @param {number} days - Number of days to add
 * @returns {string}
 */
function addDays(dateStr, days) {
  const year = parseInt(dateStr.slice(0, 4), 10);
  const month = parseInt(dateStr.slice(4, 6), 10) - 1;
  const day = parseInt(dateStr.slice(6, 8), 10);

  const date = new Date(Date.UTC(year, month, day));
  date.setUTCDate(date.getUTCDate() + days);

  const newYear = date.getUTCFullYear();
  const newMonth = String(date.getUTCMonth() + 1).padStart(2, '0');
  const newDay = String(date.getUTCDate()).padStart(2, '0');

  return `${newYear}${newMonth}${newDay}`;
}
