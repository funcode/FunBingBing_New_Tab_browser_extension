import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  compareMetadataStages,
  canReplaceMetadataStage,
  mergeMetadata,
  validateSourceCoverage
} from '../src/helpers/metadata.js';
import { readFileSync } from 'node:fs';
import { addDays } from '../src/helpers/date.js';

const targetDate = '20260728';
const targetId = 'OHR.Target_ZH-CN123';

function makeCatalog(target = targetDate) {
  const entries = {};
  for (let i = 0; i < 8; i++) {
    const date = addDays(target, -i);
    entries[date] = { date, imageId: `OHR.Image${i}_ZH-CN123`, metadataStage: 'iotd' };
  }
  entries[target].imageId = targetId;
  return { entries };
}

// Returns the verbatim JSON response recorded in docs/api.txt for the request URL fragment.
function loadApiSample(requestFragment) {
  const text = readFileSync(new URL('../docs/api.txt', import.meta.url), 'utf8');
  const block = text.split(/^=+\r?$/m).find(section => {
    const requestLine = section.match(/^Request URL: (.+)$/m);
    return requestLine && requestLine[1].includes(requestFragment);
  });
  return JSON.parse(block.slice(block.indexOf('Response:') + 'Response:'.length));
}

function makeArchive(catalog = makeCatalog()) {
  return {
    images: Object.keys(catalog.entries).sort().reverse().map(date => ({
      enddate: date,
      urlbase: `/th?id=${catalog.entries[date].imageId}`
    }))
  };
}

describe('Metadata helpers', () => {
  describe('metadata stages', () => {
    it('compares stages in ascending order', () => {
      assert.strictEqual(compareMetadataStages('iotd', 'media'), 1);
      assert.strictEqual(compareMetadataStages('media', 'preload'), 1);
      assert.strictEqual(compareMetadataStages('preload', 'archive'), 1);
      assert.strictEqual(compareMetadataStages('archive', 'legacy'), 1);
      assert.strictEqual(compareMetadataStages('iotd', 'iotd'), 0);
      assert.strictEqual(compareMetadataStages('legacy', 'iotd'), -1);
    });

    it('only allows a higher stage to replace a lower stage', () => {
      assert.strictEqual(canReplaceMetadataStage('iotd', 'legacy'), true);
      assert.strictEqual(canReplaceMetadataStage('iotd', 'iotd'), false);
    });
  });

  describe('mergeMetadata', () => {
    it('requires matching date and image identity', () => {
      assert.strictEqual(mergeMetadata({ date: targetDate, imageId: targetId }, { date: '20260729', imageId: targetId }), null);
      assert.strictEqual(mergeMetadata({ date: targetDate, imageId: targetId }, { date: targetDate, imageId: 'OHR.Other' }), null);
    });

    it('lets higher stages win while filling empty fields from lower stages', () => {
      const result = mergeMetadata(
        { date: targetDate, imageId: targetId, metadataStage: 'media', description: 'Media description', headline: 'Media headline' },
        { date: targetDate, imageId: targetId, metadataStage: 'iotd', description: '', headline: '' }
      );
      assert.strictEqual(result.metadataStage, 'iotd');
      assert.strictEqual(result.description, 'Media description');
      assert.strictEqual(result.headline, 'Media headline');
    });

    it('preserves lower-stage enrichment regardless of response order', () => {
      const iotd = { date: targetDate, imageId: targetId, metadataStage: 'iotd', title: 'IOTD', quickFact: '' };
      const archive = { date: targetDate, imageId: targetId, metadataStage: 'archive', quickFact: 'Fact', triviaId: 'HPQuiz_20260728_Foo' };
      assert.strictEqual(mergeMetadata(iotd, archive).quickFact, 'Fact');
      assert.strictEqual(mergeMetadata(archive, iotd).quickFact, 'Fact');
    });

    it('resets trivia payload and retry state when triviaId changes', () => {
      const result = mergeMetadata(
        { date: targetDate, imageId: targetId, metadataStage: 'archive', triviaId: 'HPQuiz_20260728_Old', triviaData: { answer: 1 }, triviaState: 'complete', triviaAttemptedAt: 1000, triviaNextRetryAt: 5000, triviaRetryLevel: 2 },
        { date: targetDate, imageId: targetId, metadataStage: 'iotd', triviaId: 'HPQuiz_20260728_New' }
      );
      assert.strictEqual(result.triviaId, 'HPQuiz_20260728_New');
      assert.strictEqual(result.triviaData, null);
      assert.strictEqual(result.triviaState, 'missing');
      assert.strictEqual(result.triviaAttemptedAt, 0);
      assert.strictEqual(result.triviaNextRetryAt, 0);
      assert.strictEqual(result.triviaRetryLevel, 0);
    });

    it('defaults missing persisted retry fields to zero', () => {
      const result = mergeMetadata(
        { date: targetDate, imageId: targetId, metadataStage: 'media', triviaState: 'missing' },
        { date: targetDate, imageId: targetId, metadataStage: 'iotd' }
      );
      assert.strictEqual(result.triviaAttemptedAt, 0);
      assert.strictEqual(result.triviaNextRetryAt, 0);
      assert.strictEqual(result.triviaRetryLevel, 0);
    });

    it('defaults triviaData to null when neither side has a payload', () => {
      const result = mergeMetadata(
        { date: targetDate, imageId: targetId, metadataStage: 'media' },
        { date: targetDate, imageId: targetId, metadataStage: 'iotd' }
      );
      assert.strictEqual(result.triviaData, null);
    });
  });

  describe('validateSourceCoverage', () => {
    it('validates a target anywhere in the nested IOTD image catalog', () => {
      const response = {
        data: { images: [
          { isoDate: '20260727', imageUrls: { landscape: { highDef: '/th?id=OHR.Other_ZH-CN456_1920x1080.jpg' } } },
          { isoDate: targetDate, imageUrls: { landscape: { highDef: `/th?id=${targetId}_1920x1080.jpg` } } }
        ] }
      };
      assert.strictEqual(validateSourceCoverage('imageOfTheDay', response, targetDate), true);
      assert.strictEqual(validateSourceCoverage('imageOfTheDay', response, '20260726'), false);
      assert.strictEqual(validateSourceCoverage('imageOfTheDay', { images: response.data.images }, targetDate), false);
    });

    it('requires a valid target Model entry', () => {
      const response = { MediaContents: [{ Ssd: targetDate, ImageContent: { Image: { Url: `${'https://ts1.tc.mm.bing.net/th?id='}${targetId}_1920x1080.webp` } } }] };
      assert.strictEqual(validateSourceCoverage('model', response, targetDate), true);
      assert.strictEqual(validateSourceCoverage('model', { MediaContents: [{ Ssd: targetDate }] }, targetDate), false);
    });

    it('requires a complete consecutive IOTD catalog and matching oldest Archive identity', () => {
      const catalog = makeCatalog();
      assert.strictEqual(validateSourceCoverage('archive', makeArchive(catalog), targetDate, catalog), true);
      assert.strictEqual(validateSourceCoverage('archive', { images: [makeArchive(catalog).images.at(-1)] }, targetDate, catalog), true);
      assert.strictEqual(validateSourceCoverage('archive', makeArchive(catalog), targetDate), false);

      const mismatched = makeCatalog();
      const archive = { images: [{ enddate: addDays(targetDate, -7), urlbase: '/th?id=OHR.Wrong_ZH-CN999' }] };
      assert.strictEqual(validateSourceCoverage('archive', archive, targetDate, mismatched), false);
    });

    it('accepts the real Archive n=1 and n=8 samples from docs/api.txt', () => {
      // Both samples use idx=7: enddate 20260721 is the oldest day for targetDate 20260728
      const n1 = loadApiSample('HPImageArchive.aspx?format=js&n=1&');
      const n8 = loadApiSample('HPImageArchive.aspx?format=js&n=8&');
      const sampleId = 'OHR.SantaCatalina_ZH-CN6223370790';
      const catalog = makeCatalog();
      catalog.entries['20260721'].imageId = sampleId;

      assert.strictEqual(validateSourceCoverage('archive', n1, targetDate, catalog), true);
      assert.strictEqual(validateSourceCoverage('archive', n8, targetDate, catalog), true);

      // A complete window for 20260727 whose oldest day matches the sample's startdate
      // identity must still fail: only enddate identifies the Archive day.
      const startdateCatalog = makeCatalog('20260727');
      startdateCatalog.entries['20260720'].imageId = sampleId;
      assert.strictEqual(validateSourceCoverage('archive', n1, '20260727', startdateCatalog), false);
    });

    it('stays missing when a consecutive 8-entry catalog has a non-iotd entry in the window', () => {
      for (const stage of ['legacy', 'archive', 'preload', 'media']) {
        const catalog = makeCatalog();
        catalog.entries[addDays(targetDate, -3)].metadataStage = stage;
        assert.strictEqual(Object.keys(catalog.entries).length, 8);
        assert.strictEqual(validateSourceCoverage('archive', makeArchive(catalog), targetDate, catalog), false, stage);
      }
    });

    it('stays missing when the catalog window has a gap', () => {
      const catalog = makeCatalog();
      delete catalog.entries[addDays(targetDate, -4)];
      assert.strictEqual(validateSourceCoverage('archive', makeArchive(catalog), targetDate, catalog), false);
    });

    it('rejects incomplete, duplicate, or wrong-date Archive entries', () => {
      const catalog = makeCatalog();
      const archive = makeArchive(catalog);
      archive.images = archive.images.filter(image => image.enddate !== addDays(targetDate, -7));
      assert.strictEqual(validateSourceCoverage('archive', archive, targetDate, catalog), false);
      assert.strictEqual(validateSourceCoverage('archive', { images: [{ enddate: '20260720', urlbase: '/th?id=OHR.Other_ZH-CN999' }] }, targetDate, catalog), false);
    });

    it('returns false for unknown sources and invalid dates', () => {
      assert.strictEqual(validateSourceCoverage('unknown', {}, targetDate), false);
      assert.strictEqual(validateSourceCoverage('archive', {}, '20260230', makeCatalog()), false);
    });
  });
});
