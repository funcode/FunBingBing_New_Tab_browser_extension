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

    it('higher stage fields win over lower stage fields', () => {
      const archive = { date: '20260728', imageId: 'OHR.Test', metadataStage: 'archive', title: 'Archive Title', quickFact: 'ArchiveFact' };
      const iotd    = { date: '20260728', imageId: 'OHR.Test', metadataStage: 'iotd',    title: 'IOTD Title'   };

      const result = mergeMetadata(archive, iotd);
      assert.strictEqual(result.metadataStage, 'iotd');
      assert.strictEqual(result.title, 'IOTD Title');
    });

    it('preserves lower-stage source-specific fields regardless of merge order — quickFact from Archive survives IOTD merge', () => {
      // IOTD arrives first, then Archive
      const iotd    = { date: '20260728', imageId: 'OHR.Test', metadataStage: 'iotd', title: 'IOTD Title', quickFact: '' };
      const archive = { date: '20260728', imageId: 'OHR.Test', metadataStage: 'archive', quickFact: 'ArchiveFact', triviaId: 'HPQuiz_20260728_Foo' };

      // mergeMetadata(current=iotd, candidate=archive): archive is lower, but quickFact enriches
      const result = mergeMetadata(iotd, archive);
      assert.strictEqual(result.metadataStage, 'iotd');      // higher stage wins
      assert.strictEqual(result.title, 'IOTD Title');         // higher stage title
      assert.strictEqual(result.quickFact, 'ArchiveFact');    // lower-stage-specific field preserved
      assert.strictEqual(result.triviaId, 'HPQuiz_20260728_Foo');
    });

    it('is order-independent: Archive first, then IOTD gives same enrichment', () => {
      const archive = { date: '20260728', imageId: 'OHR.Test', metadataStage: 'archive', quickFact: 'ArchiveFact', triviaId: 'HPQuiz_20260728_Foo', title: 'Archive Title' };
      const iotd    = { date: '20260728', imageId: 'OHR.Test', metadataStage: 'iotd',    title: 'IOTD Title', quickFact: '', triviaId: '' };

      const result = mergeMetadata(archive, iotd);
      assert.strictEqual(result.metadataStage, 'iotd');
      assert.strictEqual(result.title, 'IOTD Title');
      assert.strictEqual(result.quickFact, 'ArchiveFact');
      assert.strictEqual(result.triviaId, 'HPQuiz_20260728_Foo');
    });

    it('preserves trivia retry state from current', () => {
      const current = {
        date: '20260728', imageId: 'OHR.Test', metadataStage: 'archive',
        triviaId: 'HPQuiz_20260728_test', triviaAttemptedAt: 1000, triviaRetryLevel: 2,
        triviaNextRetryAt: 5000
      };
      const candidate = { date: '20260728', imageId: 'OHR.Test', metadataStage: 'iotd' };
      const result = mergeMetadata(current, candidate);
      assert.strictEqual(result.triviaAttemptedAt, 1000);
      assert.strictEqual(result.triviaRetryLevel, 2);
      assert.strictEqual(result.triviaNextRetryAt, 5000);
    });
  });

  describe('validateSourceCoverage', () => {
    it('validates IOTD coverage when images[0].isoDate matches targetDate', () => {
      // Actual IOTD fixture shape: response.images[]
      const response = { images: [{ isoDate: '20260728' }, { isoDate: '20260727' }] };
      assert.strictEqual(validateSourceCoverage('imageOfTheDay', response, '20260728'), true);
      assert.strictEqual(validateSourceCoverage('imageOfTheDay', response, '20260727'), false); // second entry, not first
    });

    it('rejects IOTD with no images array', () => {
      assert.strictEqual(validateSourceCoverage('imageOfTheDay', {}, '20260728'), false);
      assert.strictEqual(validateSourceCoverage('imageOfTheDay', { images: [] }, '20260728'), false);
    });

    it('validates Model coverage when MediaContents.Ssd equals targetDate', () => {
      const response = { MediaContents: [{ Ssd: '20260728' }, { Ssd: '20260729' }] };
      assert.strictEqual(validateSourceCoverage('model', response, '20260728'), true);
      assert.strictEqual(validateSourceCoverage('model', response, '20260727'), false);
    });

    it('validates Archive with 8 consecutive entries, correct enddate, and imageIds present', () => {
      const response = {
        enddate: '20260721',
        images: [
          { startdate: '20260728', imageId: 'OHR.A' },
          { startdate: '20260727', imageId: 'OHR.B' },
          { startdate: '20260726', imageId: 'OHR.C' },
          { startdate: '20260725', imageId: 'OHR.D' },
          { startdate: '20260724', imageId: 'OHR.E' },
          { startdate: '20260723', imageId: 'OHR.F' },
          { startdate: '20260722', imageId: 'OHR.G' },
          { startdate: '20260721', imageId: 'OHR.H' }
        ]
      };
      assert.strictEqual(validateSourceCoverage('archive', response, '20260728'), true);
    });

    it('rejects Archive when enddate does not match targetDate-7', () => {
      const response = {
        enddate: '20260720', // wrong: should be 20260721
        images: Array.from({ length: 8 }, (_, i) => ({
          startdate: `202607${String(28 - i).padStart(2, '0')}`,
          imageId: `OHR.${i}`
        }))
      };
      assert.strictEqual(validateSourceCoverage('archive', response, '20260728'), false);
    });

    it('rejects Archive when entry imageId is missing', () => {
      const images = Array.from({ length: 8 }, (_, i) => ({
        startdate: `202607${String(28 - i).padStart(2, '0')}`,
        imageId: i === 0 ? undefined : `OHR.${i}` // missing on first entry
      }));
      const response = { enddate: '20260721', images };
      assert.strictEqual(validateSourceCoverage('archive', response, '20260728'), false);
    });

    it('rejects Archive when imageId for targetDate does not match provided targetImageId', () => {
      const response = {
        enddate: '20260721',
        images: [
          { startdate: '20260728', imageId: 'OHR.Different' },
          ...Array.from({ length: 7 }, (_, i) => ({
            startdate: `202607${String(27 - i).padStart(2, '0')}`,
            imageId: `OHR.${i}`
          }))
        ]
      };
      assert.strictEqual(validateSourceCoverage('archive', response, '20260728', 'OHR.Expected'), false);
      assert.strictEqual(validateSourceCoverage('archive', response, '20260728', 'OHR.Different'), true);
    });

    it('returns false for unknown source', () => {
      assert.strictEqual(validateSourceCoverage('unknown', {}, '20260728'), false);
    });
  });
});

