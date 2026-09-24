'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCatalogWorker } = require('../scripts/plan9/catalog.js');
const P = require('../scripts/plan9/helpers.js');
const target = '20260923';
const imageId = (date) => 'OHR.Image_' + date;
const iotd = (date) => ({ isoDate: date, title: 'IOTD ' + date, imageUrls: { landscape: { highDef: '/th?id=' + imageId(date) + '_1920x1080.jpg' } } });
const media = (date) => ({ Ssd: date, ImageContent: { Image: { Url: 'https://ts1.tc.mm.bing.net/th?id=' + imageId(date) + '_1920x1080.webp' }, Headline: 'Headline ' + date, TriviaId: '' } });
function fixture(_contextId, shared) {
  const state = shared || {};
  const reads = [], writes = [], requests = [], broadcasts = [];
  const listeners = {};
  const event = (name) => ({ addListener(fn) { listeners[name] = fn; } });
  let now = Date.parse('2026-09-23T04:00:00Z');
  const chrome = {
    extension: {},
    storage: { local: {
      async get(keys) { assert.notEqual(keys, null); reads.push(keys); return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(k => [k, structuredClone(state[k])])); },
      async set(values) { writes.push(structuredClone(values)); Object.assign(state, structuredClone(values)); },
      async remove(keys) { for (const key of keys) delete state[key]; }
    }, sync: { async get(keys) { return { enable_uhd_wallpaper: 'yes', qotd_url: '' }; } }, onChanged: event('changed') },
    runtime: { onInstalled: event('installed'), onStartup: event('startup'), onMessage: event('message'), async sendMessage(message) { broadcasts.push(message); } }
  };
  let handler = async (url) => {
    if (url.includes('imageoftheday')) return { data: { images: Array.from({ length: 8 }, (_, n) => iotd(P.addDays(target, -n))) } };
    if (url.includes('/model')) return { MediaContents: [media(target)], PreloadMediaContents: [media('20260924')] };
    if (url.includes('HPImageArchive')) return { images: [{ enddate: '20260916', urlbase: '/th?id=' + imageId('20260916'), title: 'Archive headline', quiz: '' }] };
    throw Error('Unexpected URL ' + url);
  };
  const fetch = async url => { requests.push(url); return { ok: true, json: async () => handler(url) }; };
  const worker = createCatalogWorker({ chrome, fetch, now: () => now, logger: { warn() {} } });
  return { worker, state, requests, broadcasts, reads, writes, listeners, chrome, setNow(value) { now = value; }, setHandler(value) { handler = value; } };
}

test('refresh commits real Bing payloads, shared settings and context catalog without display writes', async () => {
  const f = fixture();
  await f.worker.refresh();
  const c = f.state.bing_wallpaper_catalog_v2;
  assert.equal(c.version, 2);
  assert.equal(c.refreshState.date, target);
  assert.equal(c.refreshState.generation, 1);
  assert.equal(c.refreshState.sources.imageOfTheDay.status, 'success');
  assert.equal(c.refreshState.sources.model.status, 'success');
  assert.equal(c.entries[target].metadataStage, 'iotd');
  assert.equal(c.entries[target].headline, 'Headline ' + target);
  assert.equal(c.entries['20260924'].metadataStage, 'preload');
  assert.equal(typeof c.updatedAt, 'number');
  assert.ok(f.writes.every(v => Object.keys(v).every(k => k === 'bing_wallpaper_catalog_v2')));
  assert.ok(f.broadcasts.some(m => m.type === 'wallpaperCatalogUpdated' && m.updatedDates.includes(target)));
  const count = f.requests.length;
  await f.worker.refresh();
  assert.equal(f.requests.length, count);
});

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
async function until(predicate) {
  for (let n = 0; n < 100; n++) { if (predicate()) return; await new Promise(resolve => setImmediate(resolve)); }
  assert.fail('Expected asynchronous state was not reached');
}

test('all metadata sources start in parallel and same-date requests share pending work', async () => {
  const f = fixture();
  const waiting = [];
  f.setHandler(() => { const task = deferred(); waiting.push(task); return task.promise; });
  const first = f.worker.refresh();
  assert.equal(f.worker.refresh(), first);
  await until(() => waiting.length === 3);
  for (const task of waiting) task.resolve({});
  await first;
  assert.equal(f.requests.length, 3);
});

test('source retries persist the 1, 3, 5, 5 minute sequence across restart and reset at date rollover', async () => {
  let f = fixture();
  let instant = Date.parse('2026-09-23T04:00:00Z');
  for (const delay of [60000, 180000, 300000, 300000]) {
    f.setNow(instant);
    f.setHandler(() => { throw Error('offline'); });
    await f.worker.refresh();
    const state = f.state.bing_wallpaper_catalog_v2;
    assert.equal(state.refreshState.sources.imageOfTheDay.nextRetryAt, instant + delay);
    assert.equal(state.refreshState.sources.model.nextRetryAt, instant + delay);
    const count = f.requests.length;
    await f.worker.refresh();
    assert.equal(f.requests.length, count);
    instant += delay;
    f = fixture('regular', f.state);
  }
  f.setNow(Date.parse('2026-09-24T04:00:00Z'));
  f.setHandler(url => url.includes('imageoftheday') ? { data: { images: [iotd('20260924')] } } : {});
  await f.worker.refresh();
  const next = f.state.bing_wallpaper_catalog_v2;
  assert.equal(next.refreshState.generation, 2);
  assert.equal(next.refreshState.sources.imageOfTheDay.retryLevel, 0);
  assert.equal(next.refreshState.sources.model.retryLevel, 1);
});

test('reconnect bypass is persisted before requests and a failed bypass advances the existing level', async () => {
  const f = fixture();
  f.setHandler(() => { throw Error('offline'); });
  await f.worker.refresh();
  const pending = [];
  f.setHandler(() => { const task = deferred(); pending.push(task); return task.promise; });
  const bypass = f.worker.refresh({ reconnect: true });
  await until(() => pending.length === 3);
  assert.equal(f.worker.refresh({ reconnect: true }), bypass);
  assert.ok(f.state.bing_wallpaper_catalog_v2.refreshState.sources.model.lastReconnectBypassAt > 0);
  const restarted = fixture('regular', f.state);
  await restarted.worker.refresh({ reconnect: true });
  assert.equal(restarted.requests.length, 0);
  pending.forEach(task => task.reject(Error('still offline')));
  await bypass;
  const source = f.state.bing_wallpaper_catalog_v2.refreshState.sources.model;
  assert.equal(source.retryLevel, 2);
  assert.equal(source.nextRetryAt - source.attemptedAt, 180000);
});

test('late generation drops a whole displayed-identity conflict while committing safe history and never scheduling rejected trivia', async () => {
  const f = fixture();
  const oldModel = deferred();
  const conflicting = media(target);
  conflicting.ImageContent.TriviaId = 'HPQuiz_20260923_Rejected';
  const history = media('20260922');
  history.ImageContent.TriviaId = 'HPQuiz_20260922_Allowed';
  f.state.wallpaper_display_state_v2 = { date: target, imageId: 'OHR.Displayed', url: P.canonicalImageUrl('OHR.Displayed', '_1920x1080.jpg'), preloadDataUrl: '', updatedAt: 1 };
  f.setHandler(url => url.includes('/model') ? oldModel.promise : {});
  const old = f.worker.refresh();
  await until(() => f.requests.length === 3);
  f.setNow(Date.parse('2026-09-24T04:00:00Z'));
  f.setHandler(url => url.includes('imageoftheday') ? { data: { images: [iotd('20260924')] } } : {});
  await f.worker.refresh();
  const sourceBefore = structuredClone(f.state.bing_wallpaper_catalog_v2.refreshState.sources);
  oldModel.resolve({ MediaContents: [conflicting, history] });
  await old;
  await until(() => f.requests.some(url => url.includes('HPQuiz_20260922_Allowed')));
  const c = f.state.bing_wallpaper_catalog_v2;
  assert.equal(c.entries[target], undefined);
  assert.equal(c.entries['20260922'].headline, 'Headline 20260922');
  assert.equal(c.entries['20260924'].metadataStage, 'iotd');
  assert.equal(c.refreshState.generation, 2);
  assert.deepEqual(c.refreshState.sources, sourceBefore);
  assert.ok(!f.requests.some(url => url.includes('Rejected')));
  assert.equal(f.state.wallpaper_display_state_v2.imageId, 'OHR.Displayed');
});

test('Archive validates against all eight committed IOTD dates and invalidates after identity correction', async () => {
  const f = fixture();
  await f.worker.refresh();
  const c = f.state.bing_wallpaper_catalog_v2;
  assert.equal(c.refreshState.sources.archive.status, 'success');
  assert.equal(c.entries['20260916'].headline, 'Archive headline');
  c.refreshState.sources.imageOfTheDay.status = 'missing';
  f.setHandler(url => {
    assert.ok(url.includes('imageoftheday'));
    const changed = iotd('20260916');
    changed.imageUrls.landscape.highDef = '/th?id=OHR.Corrected_1920x1080.jpg';
    return { data: { images: [iotd(target), changed] } };
  });
  await f.worker.refresh();
  const updated = f.state.bing_wallpaper_catalog_v2;
  assert.equal(updated.entries['20260916'].imageId, 'OHR.Corrected');
  assert.equal(updated.entries['20260916'].headline, '');
  assert.equal(updated.refreshState.sources.archive.status, 'missing');
});



test('startup imports production v1 state into unsuffixed names and preserves legacy inputs', async () => {
  const f = fixture(undefined, {
    bing_images: [{ isoDate: target, urlbase: imageId(target), title: 'Legacy title' }],
    cache_quote_state: { quotes: { [target]: { text: 'Old quote' } } },
    wallpaper_date: target, wallpaper_url: P.canonicalImageUrl(imageId(target), '_1920x1080.jpg')
  });
  await f.worker.refresh();
  assert.equal(f.state.bing_wallpaper_catalog_v2.version, 2);
  assert.equal(f.state.bing_wallpaper_catalog_v2.entries[target].imageId, imageId(target));
  assert.equal(f.state.cache_quote_state_v2.quotes[target].text, 'Old quote');
  assert.ok(f.state.bing_images);
  assert.ok(f.state.cache_quote_state);
});

test('metadata refresh completes without waiting for trivia and stale trivia results cannot mutate a replaced entry', async () => {
  const f = fixture();
  const quiz = deferred();
  const item = media(target);
  item.ImageContent.TriviaId = 'HPQuiz_20260923_Old';
  f.setHandler(url => {
    if (url.includes('/trivia')) return quiz.promise;
    if (url.includes('/model')) return { MediaContents: [item] };
    return {};
  });
  await f.worker.refresh();
  await until(() => f.requests.some(url => url.includes('/trivia')));
  const c = f.state.bing_wallpaper_catalog_v2;
  c.entries[target].triviaId = 'HPQuiz_20260923_Replacement';
  c.entries[target].triviaState = 'complete';
  c.entries[target].triviaData = { replacement: true };
  quiz.resolve({ old: true });
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.state.bing_wallpaper_catalog_v2.entries[target].triviaData, { replacement: true });
  assert.equal(f.state.bing_wallpaper_catalog_v2.entries[target].triviaRetryLevel, 0);
});

test('worker events, refresh messages and relevant sync changes trigger work; absent listeners are harmless', async () => {
  const f = fixture();
  const events = {};
  f.worker.install({ addEventListener(name, fn) { events[name] = fn; } });
  f.chrome.runtime.sendMessage = async () => { throw Error('Could not establish connection. Receiving end does not exist.'); };
  const response = await new Promise(resolve => assert.equal(f.listeners.message({ type: 'refreshWallpaperCatalog' }, {}, resolve), true));
  assert.equal(response.ok, true);
  assert.equal(f.listeners.message({ type: 'unrelated' }, {}, () => {}), false);
  f.listeners.installed();
  f.listeners.startup();
  f.listeners.changed({ enable_uhd_wallpaper: { newValue: 'no' } }, 'sync');
  events.online();
  await f.worker.refresh();
  assert.equal(f.requests.length, 3);
});

test('Archive extracts the API quiz search URL and schedules only its validated rewritten identity', async () => {
  const f = fixture();
  f.setHandler(url => {
    if (url.includes('imageoftheday')) return { data: { images: Array.from({ length: 8 }, (_, n) => iotd(P.addDays(target, -n))) } };
    if (url.includes('HPImageArchive')) return { images: [
      { enddate: '20260916', urlbase: '/th?id=' + imageId('20260916'), quiz: '/search?q=Bing+homepage+quiz&filters=WQOskey:%22HPQuiz_20260915_Oldest%22&FORM=HPQUIZ' },
      { enddate: '20260916', urlbase: '/th?id=OHR.Unrelated', quiz: 'HPQuiz_20260916_Rejected', title: 'Wrong identity' }
    ] };
    return {};
  });
  await f.worker.refresh();
  await until(() => f.requests.some(url => url.includes('HPQuiz_20260916_Oldest')));
  assert.equal(f.state.bing_wallpaper_catalog_v2.entries['20260916'].triviaId, 'HPQuiz_20260916_Oldest');
  assert.ok(!f.requests.some(url => url.includes('Rejected')));
});

const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

async function backgroundFixture(contextId, syncUrl) {
  const f = fixture(undefined, { qotd_url: 'https://legacy.example/quotes.json', cache_quote_state: { quotes: {} }, wallpaper_migration_v2_state: { phase: 'writing' } });
  const messages = [], changes = [];
  f.chrome.runtime.onMessage = { addListener: fn => messages.push(fn) };
  f.chrome.storage.onChanged = { addListener: fn => changes.push(fn) };
  f.chrome.storage.sync.get = async () => ({ qotd_url: syncUrl });
  const requests = [];
  const context = {
    chrome: f.chrome, importScripts() {}, addEventListener() {}, PLAN9Pure: P,
    PLAN9Catalog: require('../scripts/plan9/catalog.js'), console: { log() {}, warn() {}, error() {} },
    fetch: async url => { requests.push(url); return { ok: true, json: async () => ({ [target]: { text: 'Saved quote', caption: 'Source caption' } }) }; },
    caches: { open() { throw Error('No image work expected'); } }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../scripts/background.js'), 'utf8'), context, { filename: 'background.js' });
  const sync = requestId => new Promise((resolve, reject) => {
    try { assert.ok(messages.some(fn => fn({ type: 'syncQuotesForImages', requestId, todayDate: target, todayQuote: null, imageDates: [target] }, {}, resolve) === true)); }
    catch (error) { reject(error); }
  });
  return { ...f, requests, sync, changes };
}

test('background legacy quote endpoint preserves local fallback until migration and sync takes precedence', async () => {
  const regular = await backgroundFixture('regular', undefined);
  assert.equal((await regular.sync(1)).ok, true);
  assert.deepEqual(regular.requests, ['https://legacy.example/quotes.json']);
  assert.equal(regular.state.cache_quote_state.quotes[target].text, 'Saved quote');
  assert.ok(regular.reads.every(keys => keys !== null));
  const synced = await backgroundFixture('regular', 'https://sync.example/quotes.json');
  await synced.sync(1);
  assert.deepEqual(synced.requests, ['https://sync.example/quotes.json']);
});

test('a metadata storage failure never schedules trivia from an uncommitted candidate', async () => {
  const f = fixture();
  const item = media(target);
  item.ImageContent.TriviaId = 'HPQuiz_20260923_Uncommitted';
  f.setHandler(url => url.includes('/model') ? { MediaContents: [item] } : {});
  const set = f.chrome.storage.local.set;
  f.chrome.storage.local.set = async values => {
    if (values.bing_wallpaper_catalog_v2?.entries[target]) throw Error('storage unavailable');
    return set(values);
  };
  await assert.rejects(f.worker.refresh(), /storage unavailable/);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.state.bing_wallpaper_catalog_v2.entries[target], undefined);
  assert.ok(!f.requests.some(url => url.includes('/trivia')));
});

test('trivia persistence failure waits for an explicit refresh instead of creating a retry storm', async () => {
  const f = fixture();
  let failedCommits = 0;
  const set = f.chrome.storage.local.set;
  f.chrome.storage.local.set = async values => {
    if (values.bing_wallpaper_catalog_v2?.entries[target]?.triviaState === 'complete' && failedCommits < 3) {
      failedCommits++;
      throw Error('storage unavailable');
    }
    return set(values);
  };
  const item = media(target);
  item.ImageContent.TriviaId = 'HPQuiz_20260923_StorageFailure';
  f.setHandler(url => url.includes('/trivia') ? { data: { question: 'Quiz' } } : url.includes('/model') ? { MediaContents: [item] } : {});
  await f.worker.refresh();
  await until(() => failedCommits > 0);
  for (let n = 0; n < 10; n++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.requests.filter(url => url.includes('/trivia')).length, 1);
  failedCommits = 3;
  await f.worker.refresh();
  await until(() => f.state.bing_wallpaper_catalog_v2.entries[target].triviaState === 'complete');
  assert.equal(f.requests.filter(url => url.includes('/trivia')).length, 2);
});

test('all six metadata resolution orders produce the same field winners and successful Archive', async () => {
  const orders = [ ['iotd','model','archive'], ['iotd','archive','model'], ['model','iotd','archive'], ['model','archive','iotd'], ['archive','iotd','model'], ['archive','model','iotd'] ];
  for (const order of orders) {
    const f = fixture();
    const tasks = { iotd: deferred(), model: deferred(), archive: deferred() };
    f.setHandler(url => tasks[url.includes('imageoftheday') ? 'iotd' : url.includes('/model') ? 'model' : 'archive'].promise);
    const response = {
      iotd: { data: { images: Array.from({ length: 8 }, (_, n) => iotd(P.addDays(target, -n))) } },
      model: { MediaContents: [media(target)], PreloadMediaContents: [media('20260924')] },
      archive: { images: [{ enddate: '20260916', urlbase: '/th?id=' + imageId('20260916'), title: 'Archive headline', quiz: '' }] }
    };
    const running = f.worker.refresh();
    await until(() => f.requests.length === 3);
    for (const source of order) { tasks[source].resolve(response[source]); await new Promise(resolve => setImmediate(resolve)); }
    await running;
    const c = f.state.bing_wallpaper_catalog_v2;
    assert.equal(c.refreshState.sources.archive.status, 'success', order.join(','));
    assert.equal(c.entries['20260916'].headline, 'Archive headline', order.join(','));
    assert.equal(c.entries[target].title, 'IOTD ' + target);
    assert.equal(c.entries[target].headline, 'Headline ' + target);
    assert.equal(c.entries['20260924'].metadataStage, 'preload');
  }
});

test('reconnect during an active ordinary refresh coalesces one follow-up for sources skipped by backoff', async () => {
  const f = fixture();
  f.setHandler(() => { throw Error('offline'); });
  await f.worker.refresh();
  f.state.bing_wallpaper_catalog_v2.refreshState.sources.imageOfTheDay.nextRetryAt = 0;
  const iotdPending = deferred();
  f.setHandler(url => url.includes('imageoftheday') ? iotdPending.promise : {});
  const running = f.worker.refresh();
  await until(() => f.requests.length === 4);
  const reconnect = f.worker.refresh({ reconnect: true });
  assert.equal(f.worker.refresh({ reconnect: true }), reconnect);
  iotdPending.resolve({ data: { images: [iotd(target)] } });
  await running;
  await reconnect;
  assert.equal(f.requests.filter(url => url.includes('/model')).length, 2);
  assert.equal(f.requests.filter(url => url.includes('HPImageArchive')).length, 2);
  assert.equal(f.state.bing_wallpaper_catalog_v2.refreshState.sources.model.retryLevel, 2);
});

test('malformed replacement Archive quiz clears its previous same-source ID without scheduling it again', async () => {
  const f = fixture();
  let malformed = false;
  f.setHandler(url => {
    if (url.includes('imageoftheday')) return { data: { images: Array.from({ length: 8 }, (_, n) => iotd(P.addDays(target, -n))) } };
    if (url.includes('HPImageArchive')) return { images: [{ enddate: '20260916', urlbase: '/th?id=' + imageId('20260916'), quiz: malformed ? '/search?filters=malformed' : '/search?filters=WQOskey:%22HPQuiz_20260915_Oldest%22' }] };
    if (url.includes('/trivia')) return { data: { question: 'Valid original' } };
    return {};
  });
  await f.worker.refresh();
  await until(() => f.state.bing_wallpaper_catalog_v2.entries['20260916'].triviaState === 'complete');
  const before = f.requests.filter(url => url.includes('/trivia')).length;
  f.state.bing_wallpaper_catalog_v2.refreshState.sources.archive.status = 'missing';
  malformed = true;
  await f.worker.refresh();
  await new Promise(resolve => setImmediate(resolve));
  const entry = f.state.bing_wallpaper_catalog_v2.entries['20260916'];
  assert.equal(entry.triviaId, '');
  assert.equal(entry.triviaState, 'missing');
  assert.equal(entry.triviaData, null);
  assert.equal(f.requests.filter(url => url.includes('/trivia')).length, before);
});
