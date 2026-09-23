'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../scripts/plan9/helpers.js');
const id = 'OHR.Multi_part_Name_ZH-CN1234567890';
const entry = (date, imageId = id) => ({ date, imageId });

test('Shanghai target date is independent of process timezone', () => {
  const originalTimezone = process.env.TZ;
  try {
    for (const tz of ['America/Los_Angeles', 'UTC', 'Asia/Tokyo']) {
      process.env.TZ = tz;
      assert.equal(P.getZhCnTargetDate(new Date('2026-09-22T15:59:59Z')), '20260922');
      assert.equal(P.getZhCnTargetDate(new Date('2026-09-22T16:00:00Z')), '20260923');
    }
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  }
});

test('context keys have explicit regular and incognito suffixes', () => {
  assert.equal(P.getWallpaperContextId('catalog', 'regular'), 'catalog_regular');
  assert.equal(P.getWallpaperContextId('catalog', 'incognito'), 'catalog_incognito');
  assert.throws(() => P.getWallpaperContextId('catalog', 'private'), TypeError);
});

test('identity normalization preserves underscores and canonicalizes known suffixes', () => {
  assert.equal(P.normalizeImageId('https://ts1.tc.mm.bing.net/th?id=' + id + '_1920x1080.webp&rf=x'), id);
  assert.equal(P.canonicalImageUrl(id + '_1920x1080.webp', '_1920x1080.jpg'), 'https://ts1.tc.mm.bing.net/th?id=' + id + '_1920x1080.jpg');
  assert.throws(() => P.normalizeImageId(id + '_1280x720.jpg'), /Unsupported/);
  assert.throws(() => P.normalizeImageId('https://bing.test/th?x=y'), /identity/);
});

test('metadata field winners are independent of all source response orders', () => {
  const sources = [
    { metadataStage: 'iotd', title: 'IOTD title' },
    { metadataStage: 'media', title: 'Media title', headline: 'Media headline' },
    { metadataStage: 'preload', headline: 'Preload headline', quickFact: 'Preload fact' },
    { metadataStage: 'archive', title: 'Archive title', headline: 'Archive headline', backstageUrl: 'Archive backstage' }
  ];
  const permutations = (xs) => xs.length ? xs.flatMap((x, i) => permutations(xs.filter((_, j) => i !== j)).map((rest) => [x, ...rest])) : [[]];
  for (const order of permutations(sources)) {
    let merged = null;
    for (const source of order) merged = P.mergeMetadata(merged, { ...entry('20260923'), ...source });
    assert.equal(merged.metadataStage, 'iotd');
    assert.equal(merged.title, 'IOTD title');
    assert.equal(merged.headline, 'Media headline');
    assert.equal(merged.quickFact, 'Preload fact');
    assert.equal(merged.backstageUrl, 'Archive backstage');
    const replacement = P.mergeMetadata(merged, { ...entry('20260923', 'OHR.Replacement'), metadataStage: 'iotd', title: 'Replacement' });
    assert.equal(replacement.imageId, 'OHR.Replacement');
    assert.equal(replacement.headline, undefined);
  }
});

test('Archive coverage uses the oldest committed IOTD identity and image enddate', () => {
  const committed = Array.from({ length: 8 }, (_, n) => ({ ...entry(P.addDays('20260923', -n)), metadataStage: 'iotd' }));
  const image = { startdate: '20260915', enddate: '20260916', urlbase: '/th?id=' + id };
  const validate = (response, catalog = committed) => P.validateSourceCoverage('archive', response, '20260923', catalog).status;
  assert.equal(validate({ images: [image] }), 'success');
  assert.equal(validate({ images: [null, image] }), 'success');
  assert.equal(validate({ images: [null] }), 'missing');
  assert.equal(validate({ images: [image] }, [...committed].reverse()), 'success');
  assert.equal(validate({ images: [image] }, committed.slice(1)), 'missing');
  assert.equal(validate({ images: [image] }, committed.map((x, i) => i === 3 ? { ...x, metadataStage: 'media' } : x)), 'missing');
  assert.equal(validate({ images: [{ ...image, enddate: '20260915' }] }), 'missing');
  assert.equal(validate({ images: [{ ...image, urlbase: '/th?id=OHR.Other' }] }), 'missing');
  assert.equal(validate({ images: [image] }, []), 'missing');
});

test('stale generation cannot replace identity or conflict with displayed image', () => {
  const old = entry('20260923');
  const other = entry('20260923', 'OHR.Other_ZH-CN1234567890');
  assert.equal(P.admitStaleCandidate(old, old, { date: old.date, imageId: id }, 1, 2, '20260923'), true);
  assert.equal(P.admitStaleCandidate(other, old, { date: old.date, imageId: id }, 1, 2), false);
  assert.equal(P.admitStaleCandidate(entry('20260922'), null, { date: old.date, imageId: id }, 1, 2, '20260923'), true);
});

test('trivia admission uses triviaId regardless of date locator or generation', () => {
  assert.equal(P.admitTriviaResult({ triviaId: 'HPQuiz_20260923_X' }, 'HPQuiz_20260923_X'), true);
  assert.equal(P.admitTriviaResult({ triviaId: 'HPQuiz_20260924_X' }, 'HPQuiz_20260923_X'), false);
  assert.equal(P.normalizeTriviaId('HPQuiz_20260922_X', '20260923'), 'HPQuiz_20260923_X');
  assert.equal(P.normalizeTriviaId('HPQuiz_20261399_X', '20260923'), '');
});

test('retry backoff saturates at 1, 3, 5, 5 minutes and reconnect bypass is one-shot', () => {
  let retry = P.resetRetry();
  const delays = [];
  for (let n = 0; n < 4; n++) { retry = P.nextRetry(retry, 1000); delays.push(retry.nextRetryAt - 1000); }
  assert.deepEqual(delays, [60000, 180000, 300000, 300000]);
  assert.equal(P.canRetry(retry, 2000, true), true);
  assert.equal(P.canRetry(P.markReconnectBypass(retry, 2000), 2000, true), false);
  assert.deepEqual(P.resetRetry(), { retryLevel: 0, nextRetryAt: 0, attemptedAt: 0, lastReconnectBypassAt: 0 });
});

test('quote leases expire and replaced tokens are rejected', () => {
  const lease = P.grantQuoteLease(null, 100, 'token-a');
  assert.equal(lease.leaseUntil, 60100);
  assert.equal(P.grantQuoteLease(lease, 200, 'token-b'), null);
  assert.equal(P.acceptsQuoteLease(lease, 'token-a', 60099), true);
  assert.equal(P.acceptsQuoteLease(lease, 'token-a', 60100), false);
  assert.equal(P.acceptsQuoteLease({ token: 'token-b', leaseUntil: 70000 }, 'token-a', 200), false);
});

test('retention and future depth honor context caps and stop at gaps', () => {
  const entries = {};
  for (let n = -7; n <= 7; n++) { const date = P.addDays('20260923', n); entries[date] = entry(date, 'OHR.Wallpaper_' + date); }
  assert.equal(P.getRetentionKeys('20260923', 'regular', '_1920x1080.jpg', null, entries).length, 30);
  assert.equal(P.getRetentionKeys('20260923', 'incognito', '_1920x1080.jpg', null, entries).length, 18);
  assert.equal(P.getRetentionKeys('20260923', 'regular', '_1920x1080.jpg', { date: '20260901', imageId: 'OHR.Old', url: P.canonicalImageUrl('OHR.Old', '_UHD.jpg'), preloadDataUrl: '', updatedAt: 10 }, entries).length, 32);
  assert.equal(P.getRetentionKeys('20260923', 'incognito', '_1920x1080.jpg', { date: '20260901', imageId: 'OHR.Old', url: P.canonicalImageUrl('OHR.Old', '_UHD.jpg'), preloadDataUrl: '', updatedAt: 10 }, entries).length, 20);
  const cached = (date, suffix) => date !== '20260925' && ['_640x360.jpg', '_1920x1080.jpg'].includes(suffix);
  assert.equal(P.cachedFutureDepth('20260923', 'regular', cached), 1);
  assert.equal(P.cachedFutureDepth('20260923', 'incognito', () => true), 1);
});

test('navigation index follows display date and not a fixed slot', () => {
  assert.equal(P.navigationIndex([entry('20260920'), entry('20260922'), entry('20260923')], '20260922'), 1);
  assert.equal(P.navigationIndex([entry('20260920')], '20260923'), -1);
});

test('display state validates date, image, final URL and preview atomically', () => {
  assert.equal(P.validateDisplayState({ date: '20260923', imageId: id, url: P.canonicalImageUrl(id, '_1920x1080.jpg'), preloadDataUrl: '', updatedAt: 1 }), true);
  assert.equal(P.validateDisplayState({ date: '20260923', imageId: id, url: P.canonicalImageUrl('OHR.Other_ZH-CN1234567890', '_1920x1080.jpg'), preloadDataUrl: '', updatedAt: 1 }), false);
});

test('shared setting precedence and migration completion gates', () => {
  assert.equal(P.selectSharedSetting('bad', 'local', (value) => value === 'sync' || value === 'local', 'default'), 'local');
  assert.equal(P.selectSharedSetting('sync', 'local', (value) => value === 'sync' || value === 'local', 'default'), 'sync');
  const ready = { catalogVerified: true, regularQuoteStateVerified: true, sharedSyncSettingsVerified: true };
  assert.equal(P.isMigrationVerified(ready), true);
  assert.equal(P.isMigrationComplete(ready), false);
  assert.equal(P.isMigrationComplete({ ...ready, displayAcknowledged: true }), true);
});

test('image tasks are canonical, ordered, deduplicable, and urgent promotion preserves one copy', () => {
  const entries = [entry('20260923'), entry('20260922')];
  let tasks = P.deriveImageTasks(entries, '20260923', 'regular', '_1920x1080.jpg');
  assert.equal(tasks[0].date, '20260923');
  const url = tasks[2].url;
  tasks = P.promoteImageTask(tasks, url);
  assert.equal(tasks[0].url, url);
  assert.equal(P.dedupeImageTasks([...tasks, tasks[0]]).filter((task) => task.url === url).length, 1);
});

test('trivia failure persists bounded retry state and rejects changed work identity', () => {
  const original = { ...entry('20260923'), triviaId: 'HPQuiz_20260923_X', triviaState: 'missing', triviaRetryLevel: 0 };
  let changed = original;
  for (let n = 0; n < 4; n++) changed = P.applyTriviaResult(changed, original.triviaId, { success: false }, 1000);
  assert.equal(changed.triviaState, 'missing');
  assert.equal(changed.triviaRetryLevel, 3);
  assert.equal(changed.triviaNextRetryAt, 301000);
  assert.equal(P.applyTriviaResult(changed, 'HPQuiz_20260923_Other', { success: true, data: {} }, 2000), changed);
  const complete = P.applyTriviaResult(changed, original.triviaId, { success: true, data: null }, 2000);
  assert.equal(complete.triviaState, 'complete');
  assert.equal(complete.triviaRetryLevel, 0);
  assert.equal(complete.triviaNextRetryAt, 0);
});

test('lease token generator runs only for an actual eligible grant', () => {
  let calls = 0;
  const generateToken = () => { calls++; return 'random-uuid'; };
  assert.equal(P.grantQuoteLease({ leaseUntil: 200 }, 100, generateToken), null);
  assert.equal(P.grantQuoteLease({ nextRetryAt: 200 }, 100, generateToken), null);
  assert.equal(calls, 0);
  assert.deepEqual(P.grantQuoteLease(null, 100, generateToken), { token: 'random-uuid', leaseUntil: 60100 });
  assert.equal(calls, 1);
});

test('canonical task dedupe normalizes webp without guessing unknown suffixes', () => {
  const hd = P.canonicalImageUrl(id, '_1920x1080.jpg');
  const tasks = P.dedupeImageTasks([{ url: hd.replace('.jpg', '.webp') }, { url: hd, urgent: true }]);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].url, hd);
  assert.equal(tasks[0].urgent, true);
  assert.throws(() => P.dedupeImageTasks([{ url: hd.replace('1920x1080', '800x600') }]));
});

test('image generation gates dispatch but retained active responses may write', () => {
  const task = { url: P.canonicalImageUrl(id, '_1920x1080.jpg'), generation: 1 };
  assert.equal(P.canDispatchImageTask(task, 2, new Set(), new Set()), false);
  assert.equal(P.canWriteImageResponse(task.url, new Set([task.url])), true);
  assert.equal(P.canWriteImageResponse(task.url, new Set()), false);
  assert.equal(P.canDispatchImageTask({ ...task, generation: 2 }, 2, new Set([task.url]), new Set()), false);
  assert.equal(P.canDispatchImageTask({ ...task, generation: 2 }, 2, new Set(), new Set([task.url])), false);
  assert.equal(P.canDispatchImageTask({ ...task, generation: 2 }, 2, new Set(), new Set()), true);
});

test('display snapshot rejects invalid dates, preview resolution and noncanonical URLs', () => {
  const valid = { date: '20260923', imageId: id, url: P.canonicalImageUrl(id, '_1920x1080.jpg'), preloadDataUrl: '', updatedAt: 1 };
  for (const change of [{ date: '20260230' }, { url: P.canonicalImageUrl(id, '_640x360.jpg') }, { url: valid.url + '&pid=hp' }, { preloadDataUrl: 'https://example.com/a.jpg' }]) {
    assert.equal(P.validateDisplayState({ ...valid, ...change }), false);
  }
  assert.equal(P.validateDisplayState({ ...valid, preloadDataUrl: 'data:image/jpeg;base64,YQ==' }), true);
});

test('Archive trivia normalization rejects ambiguous date segments without guessing', () => {
  for (const bad of [undefined, null, 123, '', 'HPQuiz_20261301_Name', 'HPQuiz_20260923_Name_20260922', 'bad_20260923_Name']) {
    assert.equal(P.normalizeTriviaId(bad, '20260923'), '');
  }
});

test('lower metadata stage can fill empty fields without replacing a higher-stage value', () => {
  const current = { ...entry('20260923'), metadataStage: 'iotd', title: 'IOTD', headline: '' };
  const merged = P.mergeMetadata(current, { ...entry('20260923'), metadataStage: 'media', title: 'Media', headline: 'Headline' });
  assert.equal(merged.title, 'IOTD');
  assert.equal(merged.headline, 'Headline');
});

test('stale work adds only absent non-display history and supplements missing fields only', () => {
  for (const date of ['20260923', '20260924', '20260915']) {
    assert.equal(P.admitStaleCandidate(entry(date), null, null, 1, 2, '20260923'), false);
  }
  assert.equal(P.admitStaleCandidate(entry('20260922'), null, entry('20260922'), 1, 2, '20260923'), false);
  assert.equal(P.admitStaleCandidate(entry('20260922'), null, null, 1, 2, '20260923'), true);
  const current = { ...entry('20260922'), metadataStage: 'media', title: 'Current', headline: '' };
  const stale = { ...entry('20260922'), metadataStage: 'iotd', title: 'Stale', headline: 'Supplement' };
  const merged = P.mergeStaleMetadata(current, stale);
  assert.equal(merged.title, 'Current');
  assert.equal(merged.headline, 'Supplement');
});

test('configured final resolution determines future depth, diagnostic values never gate scheduling', () => {
  const hasHD = (date, suffix) => suffix !== '_UHD.jpg';
  assert.equal(P.cachedFutureDepth('20260923', 'regular', hasHD, '_1920x1080.jpg'), 7);
  assert.equal(P.cachedFutureDepth('20260923', 'regular', hasHD, '_UHD.jpg'), 0);
  const records = [{ ...entry('20260924'), cachedFutureDepth: 7 }];
  assert.equal(P.deriveImageTasks(records, '20260923', 'regular', '_UHD.jpg').length, 2);
});

test('retry sequence survives restart while independent identities remain unchanged', () => {
  const source = P.nextRetry(P.resetRetry(), 1000);
  const image = P.nextRetry(P.resetRetry(), 2000);
  const restarted = JSON.parse(JSON.stringify(source));
  assert.equal(P.nextRetry(restarted, 3000).retryLevel, 2);
  assert.equal(image.retryLevel, 1);
  assert.equal(source.retryLevel, 1);
  assert.equal(P.canRetry(source, 61000), true);
  assert.deepEqual(P.resetRetry(), { retryLevel: 0, nextRetryAt: 0, attemptedAt: 0, lastReconnectBypassAt: 0 });
});

test('IOTD source coverage reads the real API data envelope', () => {
  const image = { isoDate: '20260923', imageUrls: { landscape: { highDef: '/th?id=' + id + '_1920x1080.jpg' } } };
  assert.equal(P.validateSourceCoverage('imageOfTheDay', { data: { images: [image] } }, '20260923').status, 'success');
  assert.equal(P.validateSourceCoverage('imageOfTheDay', { data: { images: [image] } }, '20260924').status, 'missing');
});

test('known WebP source resolutions converge on their canonical JPEG keys', () => {
  for (const resolution of ['640x360', '1920x1080', 'UHD']) {
    const url = 'https://ts1.tc.mm.bing.net/th?id=' + id + '_' + resolution + '.webp';
    assert.equal(P.normalizeImageId(url), id);
    assert.equal(P.canonicalizeImageTaskUrl(url), P.canonicalImageUrl(id, '_' + resolution + '.jpg'));
  }
});

test('explicit missing trivia clears the owning source payload without overriding higher-priority IDs', () => {
  const archive = { ...entry('20260916'), metadataStage: 'archive', triviaId: 'HPQuiz_20260916_Old' };
  const iotd = { ...entry('20260916'), metadataStage: 'iotd', title: 'IOTD' };
  let current = P.mergeMetadata(P.mergeMetadata(null, archive), iotd);
  Object.assign(current, { triviaState: 'complete', triviaData: { question: 'Old quiz' }, triviaRetryLevel: 2, triviaNextRetryAt: 5000 });
  const cleared = P.mergeMetadata(current, { ...archive, triviaId: '' });
  assert.equal(cleared.triviaId, '');
  assert.equal(cleared.triviaState, 'missing');
  assert.equal(cleared.triviaData, null);
  assert.equal(cleared.triviaRetryLevel, 0);
  assert.equal(cleared.metadataStage, 'iotd');
  const media = { ...entry('20260916'), metadataStage: 'media', triviaId: 'HPQuiz_20260916_Authoritative' };
  current = P.mergeMetadata(current, media);
  assert.equal(P.mergeMetadata(current, { ...archive, triviaId: '' }).triviaId, media.triviaId);
  const missingMedia = P.mergeMetadata(current, { ...media, triviaId: '' });
  assert.equal(P.mergeMetadata(missingMedia, archive).triviaId, '');
});
