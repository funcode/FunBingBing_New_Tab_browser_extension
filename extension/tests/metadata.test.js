import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  compareMetadataStages,
  canReplaceMetadataStage,
  mergeMetadata,
  validateSourceCoverage
} from '../src/helpers/metadata.js';

describe('Metadata helpers', () => {
  describe('compareMetadataStages', () => {
    it('compares stages correctly: iotd > media > preload > archive > legacy', () => {
      assert.strictEqual(compareMetadataStages('iotd', 'media'), 1);
      assert.strictEqual(compareMetadataStages('media', 'preload'), 1);
      assert.strictEqual(compareMetadataStages('preload', 'archive'), 1);
      assert.strictEqual(compareMetadataStages('archive', 'legacy'), 1);
    });

    it('returns 0 for equal stages', () => {
      assert.strictEqual(compareMetadataStages('iotd', 'iotd'), 0);
      assert.strictEqual(compareMetadataStages('legacy', 'legacy'), 0);
    });

    it('returns -1 for lower stages', () => {
      assert.strictEqual(compareMetadataStages('legacy', 'archive'), -1);
      assert.strictEqual(compareMetadataStages('media', 'iotd'), -1);
    });
  });

  describe('canReplaceMetadataStage', () => {
    it('allows higher stage to replace lower stage', () => {
      assert.strictEqual(canReplaceMetadataStage('iotd', 'legacy'), true);
      assert.strictEqual(canReplaceMetadataStage('media', 'archive'), true);
    });

    it('does not allow same or lower stage to replace', () => {
      assert.strictEqual(canReplaceMetadataStage('legacy', 'iotd'), false);
      assert.strictEqual(canReplaceMetadataStage('iotd', 'iotd'), false);
    });
  });

  describe('mergeMetadata', () => {
    it('returns null when date differs', () => {
      const current = { date: '20260728', imageId: 'OHR.Test' };
      const candidate = { date: '20260729', imageId: 'OHR.Test' };
      assert.strictEqual(mergeMetadata(current, candidate), null);
    });

    it('returns null when imageId differs', () => {
      const current = { date: '20260728', imageId: 'OHR.Test1' };
      const candidate = { date: '20260728', imageId: 'OHR.Test2' };
      assert.strictEqual(mergeMetadata(current, candidate), null);
    });

    it('keeps current when candidate stage is not higher', () => {
      const current = { date: '20260728', imageId: 'OHR.Test', metadataStage: 'iotd', title: 'Original' };
      const candidate = { date: '20260728', imageId: 'OHR.Test', metadataStage: 'media', title: 'New' };
      const result = mergeMetadata(current, candidate);
      assert.strictEqual(result.title, 'Original');
      assert.strictEqual(result.metadataStage, 'iotd');
    });

    it('merges with higher stage data taking precedence', () => {
      const current = { date: '20260728', imageId: 'OHR.Test', metadataStage: 'archive', title: 'Old' };
      const candidate = { date: '20260728', imageId: 'OHR.Test', metadataStage: 'iotd', title: 'New', copyright: 'Test' };
      const result = mergeMetadata(current, candidate);
      assert.strictEqual(result.title, 'New');
      assert.strictEqual(result.copyright, 'Test');
      assert.strictEqual(result.metadataStage, 'iotd');
    });

    it('preserves trivia state from current', () => {
      const current = {
        date: '20260728',
        imageId: 'OHR.Test',
        metadataStage: 'archive',
        triviaId: 'HPQuiz_20260728_test',
        triviaAttemptedAt: 1000,
        triviaRetryLevel: 2
      };
      const candidate = {
        date: '20260728',
        imageId: 'OHR.Test',
        metadataStage: 'iotd'
      };
      const result = mergeMetadata(current, candidate);
      assert.strictEqual(result.triviaId, 'HPQuiz_20260728_test');
      assert.strictEqual(result.triviaAttemptedAt, 1000);
      assert.strictEqual(result.triviaRetryLevel, 2);
    });
  });

  describe('validateSourceCoverage', () => {
    it('validates IOTD coverage when isoDate matches targetDate', () => {
      const response = {
        images: [
          { isoDate: '20260728' },
          { isoDate: '20260727' }
        ]
      };
      assert.strictEqual(validateSourceCoverage('imageOfTheDay', response, '20260728'), true);
      assert.strictEqual(validateSourceCoverage('imageOfTheDay', response, '20260726'), false);
    });

    it('validates Model coverage when MediaContents.Ssd equals targetDate', () => {
      const response = {
        MediaContents: [
          { Ssd: '20260728' },
          { Ssd: '20260729' }
        ]
      };
      assert.strictEqual(validateSourceCoverage('model', response, '20260728'), true);
      assert.strictEqual(validateSourceCoverage('model', response, '20260727'), false);
    });

    it('validates Archive with 8 consecutive entries and correct enddate', () => {
      const response = {
        enddate: '20260721',
        images: [
          { startdate: '20260728' },
          { startdate: '20260727' },
          { startdate: '20260726' },
          { startdate: '20260725' },
          { startdate: '20260724' },
          { startdate: '20260723' },
          { startdate: '20260722' },
          { startdate: '20260721' }
        ]
      };
      assert.strictEqual(validateSourceCoverage('archive', response, '20260728'), true);
    });

    it('rejects Archive with wrong enddate', () => {
      const response = {
        enddate: '20260720', // Should be 20260721
        images: [
          { startdate: '20260728' },
          { startdate: '20260727' },
          { startdate: '20260726' },
          { startdate: '20260725' },
          { startdate: '20260724' },
          { startdate: '20260723' },
          { startdate: '20260722' },
          { startdate: '20260721' }
        ]
      };
      assert.strictEqual(validateSourceCoverage('archive', response, '20260728'), false);
    });

    it('rejects Archive with wrong number of entries', () => {
      const response = {
        enddate: '20260721',
        images: [
          { startdate: '20260728' },
          { startdate: '20260727' }
        ]
      };
      assert.strictEqual(validateSourceCoverage('archive', response, '20260728'), false);
    });
  });
});
