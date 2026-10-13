import { describe, it } from 'node:test';
import assert from 'node:assert';
import { deriveImageWork } from '../src/worker/image-work.js';

const TARGET = '20260728';
const CDN = 'https://ts1.tc.mm.bing.net/th?id=';

function entry(date) {
  const id = `OHR.Day${date}_ZH-CN1`;
  return {
    date,
    imageId: id,
    urls: {
      preview: `${CDN}${id}_640x360.jpg`,
      highDef: `${CDN}${id}_1920x1080.jpg`,
      ultraHighDef: `${CDN}${id}_UHD.jpg`
    }
  };
}

function catalogWith(dates, target = TARGET) {
  return {
    version: 2,
    refreshState: { date: target, generation: 1, sources: {}, imageFailures: {} },
    entries: Object.fromEntries(dates.map(date => [date, entry(date)]))
  };
}

const label = item => `${item.phase}:${item.date}:${item.url.slice(item.url.lastIndexOf('_') + 1)}`;

describe('deriveImageWork', () => {
  it('orders target, history nearest first, then future nearest first, previews before finals', () => {
    const catalog = catalogWith(['20260730', '20260726', '20260728', '20260727', '20260729']);
    assert.deepStrictEqual(deriveImageWork(catalog, false).map(label), [
      'target:20260728:640x360.jpg',
      'target:20260728:1920x1080.jpg',
      'history:20260727:640x360.jpg',
      'history:20260726:640x360.jpg',
      'history:20260727:1920x1080.jpg',
      'history:20260726:1920x1080.jpg',
      'future:20260729:640x360.jpg',
      'future:20260730:640x360.jpg',
      'future:20260729:1920x1080.jpg',
      'future:20260730:1920x1080.jpg'
    ]);
  });

  it('uses the UHD final resolution when enabled and keeps the same preview keys', () => {
    const catalog = catalogWith(['20260728', '20260727']);
    assert.deepStrictEqual(deriveImageWork(catalog, true).map(label), [
      'target:20260728:640x360.jpg',
      'target:20260728:UHD.jpg',
      'history:20260727:640x360.jpg',
      'history:20260727:UHD.jpg'
    ]);
  });

  it('derives history without a target entry or future (Model) entries', () => {
    const catalog = catalogWith(['20260727']);
    assert.deepStrictEqual(deriveImageWork(catalog, false).map(label), [
      'history:20260727:640x360.jpg',
      'history:20260727:1920x1080.jpg'
    ]);
  });

  it('limits work to seven historical and seven future dates', () => {
    const dates = [];
    for (let day = 10; day <= 31; day++) dates.push(`202607${day}`);
    dates.push('20260801', '20260802', '20260803', '20260804', '20260805', '20260806');
    const work = deriveImageWork(catalogWith(dates), false);
    const workDates = [...new Set(work.map(item => item.date))].sort();
    assert.strictEqual(workDates[0], '20260721');
    assert.strictEqual(workDates[workDates.length - 1], '20260804');
    assert.strictEqual(work.length, 30);
  });

  it('returns no work before the catalog has a target date', () => {
    assert.deepStrictEqual(deriveImageWork(catalogWith(['20260728'], ''), false), []);
  });
});
