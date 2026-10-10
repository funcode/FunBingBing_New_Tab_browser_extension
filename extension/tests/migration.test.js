import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  migrateSharedSetting,
  validateBooleanSetting,
  validateUrlSetting,
  isMigrationVerified,
  isMigrationComplete,
  createMigrationState
} from '../src/helpers/migration.js';

describe('Migration helpers', () => {
  describe('migrateSharedSetting', () => {
    it('prefers valid sync value', () => {
      const result = migrateSharedSetting(true, false, false, validateBooleanSetting);
      assert.strictEqual(result, true);
    });

    it('falls back to valid local value when sync invalid', () => {
      const result = migrateSharedSetting('invalid', true, false, validateBooleanSetting);
      assert.strictEqual(result, true);
    });

    it('uses default when both sync and local invalid', () => {
      const result = migrateSharedSetting('invalid', 'also-invalid', false, validateBooleanSetting);
      assert.strictEqual(result, false);
    });

    it('prefers sync even when local is also valid', () => {
      const result = migrateSharedSetting(true, false, true, validateBooleanSetting);
      assert.strictEqual(result, true);
    });
  });

  describe('validateBooleanSetting', () => {
    it('validates boolean values', () => {
      assert.strictEqual(validateBooleanSetting(true), true);
      assert.strictEqual(validateBooleanSetting(false), true);
    });

    it('rejects non-boolean values', () => {
      assert.strictEqual(validateBooleanSetting('true'), false);
      assert.strictEqual(validateBooleanSetting(1), false);
      assert.strictEqual(validateBooleanSetting(null), false);
    });
  });

  describe('validateUrlSetting', () => {
    it('validates proper URLs', () => {
      assert.strictEqual(validateUrlSetting('https://example.com'), true);
      assert.strictEqual(validateUrlSetting('https://example.com/path'), true);
    });

    it('rejects invalid URLs', () => {
      assert.strictEqual(validateUrlSetting('not-a-url'), false);
      assert.strictEqual(validateUrlSetting(''), false);
      assert.strictEqual(validateUrlSetting(null), false);
    });
  });

  describe('isMigrationVerified', () => {
    it('returns true when all required data is present', () => {
      const state = {
        hasCatalog: true,
        hasQuoteState: true,
        hasSharedSettings: true
      };
      assert.strictEqual(isMigrationVerified(state), true);
    });

    it('returns false when catalog missing', () => {
      const state = {
        hasCatalog: false,
        hasQuoteState: true,
        hasSharedSettings: true
      };
      assert.strictEqual(isMigrationVerified(state), false);
    });

    it('returns false when any required field missing', () => {
      assert.strictEqual(isMigrationVerified({ hasCatalog: true, hasQuoteState: false }), false);
      assert.strictEqual(isMigrationVerified(null), false);
    });
  });

  describe('isMigrationComplete', () => {
    it('returns true when verified and display acknowledged', () => {
      const state = {
        hasCatalog: true,
        hasQuoteState: true,
        hasSharedSettings: true,
        displayAcknowledged: true
      };
      assert.strictEqual(isMigrationComplete(state), true);
    });

    it('returns false when verified but display not acknowledged', () => {
      const state = {
        hasCatalog: true,
        hasQuoteState: true,
        hasSharedSettings: true,
        displayAcknowledged: false
      };
      assert.strictEqual(isMigrationComplete(state), false);
    });

    it('returns false when not verified', () => {
      const state = {
        hasCatalog: false,
        hasQuoteState: true,
        hasSharedSettings: true,
        displayAcknowledged: true
      };
      assert.strictEqual(isMigrationComplete(state), false);
    });
  });

  describe('createMigrationState', () => {
    it('creates initial migration state', () => {
      const state = createMigrationState();
      assert.strictEqual(state.version, 2);
      assert.strictEqual(state.phase, 'pending');
      assert.strictEqual(state.hasCatalog, false);
      assert.strictEqual(state.hasQuoteState, false);
      assert.strictEqual(state.hasSharedSettings, false);
      assert.strictEqual(state.displayAcknowledged, false);
    });
  });
});
