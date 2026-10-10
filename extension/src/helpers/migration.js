/**
 * Migration helpers for PLAN9.
 * ADR-0004: Migration is regular-context only
 * Shared-setting migration precedence: valid sync > valid local > default
 */

/**
 * Migrate a shared setting with precedence: sync > local > default.
 * @param {*} syncValue - Value from chrome.storage.sync
 * @param {*} localValue - Value from chrome.storage.local
 * @param {*} defaultValue - Default value
 * @param {Function} validator - Function to validate the value
 * @returns {*} Migrated value
 */
export function migrateSharedSetting(syncValue, localValue, defaultValue, validator) {
  // Valid sync value takes precedence
  if (syncValue !== undefined && syncValue !== null && validator(syncValue)) {
    return syncValue;
  }

  // Valid local value is fallback
  if (localValue !== undefined && localValue !== null && validator(localValue)) {
    return localValue;
  }

  // Default value as last resort
  return defaultValue;
}

/**
 * Validate boolean setting value.
 * @param {*} value - Value to validate
 * @returns {boolean}
 */
export function validateBooleanSetting(value) {
  return typeof value === 'boolean';
}

/**
 * Validate URL setting value.
 * Only absolute HTTPS URLs are accepted as qotd_url.
 * @param {*} value - Value to validate
 * @returns {boolean}
 */
export function validateUrlSetting(value) {
  if (typeof value !== 'string' || !value) {
    return false;
  }

  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Check if migration is verified (all required data present).
 * Migration requires: catalog, regular quote state, and all shared sync settings.
 *
 * @param {Object} state - Migration state
 * @returns {boolean}
 */
export function isMigrationVerified(state) {
  if (!state) {
    return false;
  }

  return (
    state.hasCatalog === true &&
    state.hasQuoteState === true &&
    state.hasSharedSettings === true
  );
}

/**
 * Check if migration is complete (verified + display acknowledged).
 * @param {Object} state - Migration state
 * @returns {boolean}
 */
export function isMigrationComplete(state) {
  if (!isMigrationVerified(state)) {
    return false;
  }

  return state.displayAcknowledged === true;
}

/**
 * Create initial migration state.
 * @returns {Object} Initial migration state
 */
export function createMigrationState() {
  return {
    version: 2,
    phase: 'pending',
    hasCatalog: false,
    hasQuoteState: false,
    hasSharedSettings: false,
    displayAcknowledged: false,
    startedAt: 0,
    verifiedAt: 0,
    completedAt: 0
  };
}
