import { describe, it } from 'node:test';
import assert from 'node:assert';
import { addDays } from '../src/helpers/date.js';
import { createEmptyCatalog } from '../src/worker/catalog.js';
import { createCatalogService } from '../src/worker/catalog-service.js';
import { createQuoteService } from '../src/worker/quote-service.js';
import { STORAGE_KEYS } from '../src/worker/storage-keys.js';

const TARGET = '20261015';
const YESTERDAY = addDays(TARGET, -1);
const TOMORROW = addDays(TARGET, 1);
const MINUTE = 60 * 1000;
const START = 1_000_000;
const FALLBACK_URL = 'https://quotes.example/qotd.json';
const quiet = { warn() {} };

const quoteOf = (date, caption = `Caption ${date}`) => ({
  text: `Quote ${date}`,
  source: `Author ${date}`,
  caption,
  link: `https://cn.bing.com/search?q=${encodeURIComponent(`Author ${date}`)}&form=BTQUOT`
});

function catalogOf(dates) {
  const catalog = createEmptyCatalog();
  catalog.refreshState.date = TARGET;
  for (const date of dates) {
    catalog.entries[date] = { date, imageId: `OHR.Day${date}_ZH-CN1` };
  }
  return catalog;
}

function makeStorage(initial) {
  const data = structuredClone(initial);
  const writtenKeys = new Set();
  return {
    data,
    writtenKeys,
    async get(key) {
      const keys = Array.isArray(key) ? key : [key];
      return Object.fromEntries(keys.filter(k => k in data).map(k => [k, structuredClone(data[k])]));
    },
    async set(items) {
      Object.keys(items).forEach(key => writtenKeys.add(key));
      Object.assign(data, structuredClone(items));
    }
  };
}

/**
 * The quote service over a committed catalog of `dates`. `fallback(url)`
 * answers the worker's qotd_url request with a Response.
 */
function makeWorker({ dates = [TARGET, YESTERDAY, TOMORROW], quotes = {}, sync = { qotd_url: FALLBACK_URL }, fallback } = {}) {
  const storage = makeStorage({
    [STORAGE_KEYS.catalog]: catalogOf(dates),
    [STORAGE_KEYS.quoteState]: { quotes }
  });
  const worker = {
    storage,
    sync: makeStorage(sync),
    clock: { now: START },
    fetches: [],
    broadcasts: [],
    tokens: 0
  };
  worker.service = createQuoteService({
    catalogService: createCatalogService({ storage, fetchJson: async () => ({}), log: quiet }),
    storage,
    syncStorage: worker.sync,
    fetch: async (url, init) => {
      worker.fetches.push({ url, init });
      return fallback ? fallback(url) : new Response('{}');
    },
    generateToken: () => `token-${++worker.tokens}`,
    now: () => worker.clock.now,
    broadcast: message => worker.broadcasts.push(message),
    log: quiet
  });
  worker.quotes = () => storage.data[STORAGE_KEYS.quoteState].quotes;
  worker.lease = () => storage.data[STORAGE_KEYS.quoteLease];
  return worker;
}

const json = value => new Response(JSON.stringify(value));
const RELEASED = {
  date: TARGET, token: '', leaseUntil: 0, retryLevel: 0, nextRetryAt: 0, attemptedAt: 0, lastReconnectBypassAt: 0
};

describe('quote service', () => {
  it('grants one lease for the latest committed current or historical date to overlapping requests', async () => {
    const worker = makeWorker();

    const grants = await Promise.all([worker.service.requestLease(), worker.service.requestLease()]);

    assert.deepStrictEqual(grants.filter(grant => grant.granted),
      [{ granted: true, date: TARGET, token: 'token-1', scrape: true }]);
    assert.strictEqual(worker.tokens, 1, 'a denied request generates no token');
    assert.deepStrictEqual(worker.lease(), {
      date: TARGET, token: 'token-1', leaseUntil: START + MINUTE, retryLevel: 0, nextRetryAt: 0, attemptedAt: 0, lastReconnectBypassAt: 0
    });
  });

  it('grants no lease while every committed date has a captioned quote', async () => {
    const worker = makeWorker({ quotes: { [TARGET]: quoteOf(TARGET), [YESTERDAY]: quoteOf(YESTERDAY) } });

    assert.deepStrictEqual(await worker.service.requestLease(), { granted: false });
    assert.strictEqual(worker.lease(), undefined);
  });

  it('stores the lease holder\'s quote, clears the lease and notifies pages', async () => {
    const worker = makeWorker({ quotes: { [YESTERDAY]: quoteOf(YESTERDAY) } });
    const { token } = await worker.service.requestLease();

    const result = await worker.service.submit({
      date: TARGET,
      token,
      quote: { text: '“Quote 20261015”', source: 'Author 20261015', caption: 'Caption 20261015', link: '/search?q=Author' }
    });

    assert.deepStrictEqual(result, { ok: true, updatedDates: [TARGET] });
    assert.deepStrictEqual(worker.quotes()[TARGET], { ...quoteOf(TARGET), link: 'https://cn.bing.com/search?q=Author' });
    assert.deepStrictEqual(worker.lease(), RELEASED);
    assert.deepStrictEqual(worker.broadcasts, [{ type: 'quotesUpdated', updatedDates: [TARGET] }]);
    assert.deepStrictEqual(worker.fetches, [], 'complete quotes need no fallback');
    assert.deepStrictEqual([...worker.storage.writtenKeys].sort(), [STORAGE_KEYS.quoteState, STORAGE_KEYS.quoteLease].sort(),
      'quote work never writes the catalog or display state');
  });

  it('rejects expired and replaced tokens without changing quote or retry state, then accepts the replacement', async () => {
    const worker = makeWorker();
    const first = await worker.service.requestLease();
    worker.clock.now += MINUTE;
    const before = structuredClone(worker.storage.data);

    assert.deepStrictEqual(await worker.service.submit({ date: TARGET, token: first.token, quote: quoteOf(TARGET) }),
      { ok: false, rejected: true });
    assert.deepStrictEqual(worker.storage.data, before);

    const replacement = await worker.service.requestLease();
    assert.strictEqual(replacement.token, 'token-2');
    const replaced = structuredClone(worker.storage.data);
    assert.deepStrictEqual(await worker.service.submit({ date: TARGET, token: first.token, quote: quoteOf(TARGET) }),
      { ok: false, rejected: true });
    assert.deepStrictEqual(worker.storage.data, replaced);

    const accepted = await worker.service.submit({ date: TARGET, token: replacement.token, quote: quoteOf(TARGET) });
    assert.strictEqual(accepted.ok, true);
    assert.deepStrictEqual(worker.quotes()[TARGET], quoteOf(TARGET));
  });

  it('rejects a fallback commit after the lease was replaced during the fallback', async () => {
    let answer;
    const fetched = new Promise(resolve => {
      answer = resolve;
    });
    let respond;
    const worker = makeWorker({
      fallback: () => {
        answer();
        return new Promise(resolve => {
          respond = resolve;
        });
      }
    });
    const first = await worker.service.requestLease();
    const pending = worker.service.submit({ date: TARGET, token: first.token, quote: null });
    await fetched;

    worker.clock.now += MINUTE;
    const replacement = await worker.service.requestLease();
    assert.strictEqual(replacement.granted, true);
    const replaced = structuredClone(worker.storage.data);
    respond(json({ [TARGET]: quoteOf(TARGET), [YESTERDAY]: quoteOf(YESTERDAY) }));

    assert.deepStrictEqual(await pending, { ok: false, rejected: true });
    assert.deepStrictEqual(worker.storage.data, replaced);
    assert.deepStrictEqual(worker.broadcasts, []);
  });

  it('commits a successful target scrape and resets its retries before the historical fallback', async () => {
    let respond;
    const worker = makeWorker({
      fallback: () => new Promise(resolve => {
        respond = resolve;
      })
    });
    const failed = worker.service.submit({ date: TARGET, ...(await worker.service.requestLease()), quote: null });
    await new Promise(resolve => setImmediate(resolve));
    respond(new Response('{}'));
    await failed;
    assert.strictEqual(worker.lease().retryLevel, 1);
    worker.clock.now += MINUTE;
    const { token } = await worker.service.requestLease();

    const pending = worker.service.submit({ date: TARGET, token, quote: quoteOf(TARGET) });
    await new Promise(resolve => setImmediate(resolve));

    assert.deepStrictEqual(worker.quotes(), { [TARGET]: quoteOf(TARGET) });
    assert.deepStrictEqual(worker.lease(), RELEASED);
    assert.deepStrictEqual(worker.broadcasts, [{ type: 'quotesUpdated', updatedDates: [TARGET] }]);

    respond(new Response('{}'));
    assert.deepStrictEqual(await pending, { ok: true, updatedDates: [TARGET] });
    assert.deepStrictEqual(worker.lease(), RELEASED, 'a missing historical quote does not back off the target');
  });

  it('resets the target retries when the fallback fills its quote but not a historical one', async () => {
    const answers = [{}, { [TARGET]: quoteOf(TARGET) }];
    const worker = makeWorker({ fallback: () => json(answers.shift()) });
    await worker.service.submit({ date: TARGET, ...(await worker.service.requestLease()), quote: null });
    assert.strictEqual(worker.lease().retryLevel, 1, 'the first round fills nothing');
    worker.clock.now += MINUTE;

    const { token } = await worker.service.requestLease();
    const result = await worker.service.submit({ date: TARGET, token, quote: null });

    assert.deepStrictEqual(result, { ok: true, updatedDates: [TARGET] });
    assert.deepStrictEqual(worker.quotes(), { [TARGET]: quoteOf(TARGET) });
    assert.deepStrictEqual(worker.lease(), RELEASED);
  });

  it('falls back to the sync qotd_url for committed dates the scrape did not fill', async () => {
    const stray = addDays(TARGET, -30);
    const worker = makeWorker({
      fallback: () => json({
        [TARGET]: { text: `Quote ${TARGET}`, source: `Author ${TARGET}`, caption: `Caption ${TARGET}` },
        [YESTERDAY]: { text: `Quote ${YESTERDAY}`, source: `Author ${YESTERDAY}`, caption: `Caption ${YESTERDAY}` },
        [TOMORROW]: { text: 'Future', caption: 'Not a quote date' },
        [stray]: { text: 'Uncommitted', caption: 'Not a quote date' }
      })
    });
    const { token } = await worker.service.requestLease();

    const result = await worker.service.submit({ date: TARGET, token, quote: null });

    assert.deepStrictEqual(worker.fetches,
      [{ url: FALLBACK_URL, init: { credentials: 'omit', cache: 'no-store', redirect: 'error' } }]);
    assert.deepStrictEqual(result, { ok: true, updatedDates: [TARGET, YESTERDAY] });
    assert.deepStrictEqual(worker.quotes(), { [TARGET]: quoteOf(TARGET), [YESTERDAY]: quoteOf(YESTERDAY) });
    assert.deepStrictEqual(worker.lease(), RELEASED);
  });

  it('reads qotd_url from sync storage at each fallback without copying it locally', async () => {
    const worker = makeWorker({ fallback: () => new Response('', { status: 503 }) });
    await worker.service.submit({ date: TARGET, ...(await worker.service.requestLease()), quote: null });

    worker.sync.data.qotd_url = 'https://other.example/qotd.json';
    worker.clock.now += MINUTE;
    await worker.service.submit({ date: TARGET, ...(await worker.service.requestLease()), quote: null });

    assert.deepStrictEqual(worker.fetches.map(request => request.url), [FALLBACK_URL, 'https://other.example/qotd.json']);
    assert.ok(!('qotd_url' in worker.storage.data));
  });

  it('backs off a round that leaves quotes missing, and never requests a non-HTTPS qotd_url', async () => {
    const worker = makeWorker({ sync: { qotd_url: 'http://quotes.example/qotd.json' } });
    const { token } = await worker.service.requestLease();

    await worker.service.submit({ date: TARGET, token, quote: null });

    assert.deepStrictEqual(worker.fetches, []);
    assert.deepStrictEqual(worker.lease(), {
      ...RELEASED, retryLevel: 1, nextRetryAt: START + MINUTE, attemptedAt: START
    });
    worker.clock.now = START + MINUTE - 1;
    assert.deepStrictEqual(await worker.service.requestLease(), { granted: false });
    worker.clock.now = START + MINUTE;
    assert.strictEqual((await worker.service.requestLease()).granted, true);
  });

  it('lets a reconnect bypass the quote backoff window once', async () => {
    const worker = makeWorker();
    await worker.service.submit({ date: TARGET, ...(await worker.service.requestLease()), quote: null });
    worker.clock.now += 10 * 1000;

    assert.deepStrictEqual(await worker.service.requestLease(), { granted: false });
    const bypass = await worker.service.requestLease({ reconnect: true });
    assert.strictEqual(bypass.granted, true);
    assert.strictEqual(worker.lease().retryLevel, 1, 'a bypass keeps the level');

    await worker.service.submit({ date: TARGET, token: bypass.token, quote: null });
    assert.strictEqual(worker.lease().retryLevel, 2, 'a failed bypass advances the level');
    assert.deepStrictEqual(await worker.service.requestLease(), { granted: false });
  });

  for (const [label, body] of [
    ['an oversized', JSON.stringify({ [TARGET]: quoteOf(TARGET), padding: 'x'.repeat(64 * 1024) })],
    ['a malformed', JSON.stringify({ [TARGET]: { text: 'Quote', source: 42, caption: 'Caption' } })],
    ['a non-JSON', '<html>quote</html>']
  ]) {
    it(`keeps a cached blank-caption quote when the fallback is ${label} response`, async () => {
      const blank = quoteOf(TARGET, '');
      const worker = makeWorker({ dates: [TARGET], quotes: { [TARGET]: blank }, fallback: () => new Response(body) });
      const grant = await worker.service.requestLease();
      assert.strictEqual(grant.scrape, true, 'a blank caption is recovered like a missing quote');

      const result = await worker.service.submit({ date: TARGET, token: grant.token, quote: null });

      assert.deepStrictEqual(result, { ok: true, updatedDates: [] });
      assert.deepStrictEqual(worker.quotes()[TARGET], blank);
      assert.strictEqual(worker.lease().retryLevel, 1);
      assert.deepStrictEqual(worker.broadcasts, []);
    });
  }

  it('keeps a scraped quote without a caption as the best-effort quote, still recoverable', async () => {
    const worker = makeWorker({ dates: [TARGET], sync: {} });
    const grant = await worker.service.requestLease();

    const result = await worker.service.submit({
      date: TARGET, token: grant.token, quote: { text: 'Usable Bing quote', source: 'Author', link: '', caption: '' }
    });

    assert.deepStrictEqual(result, { ok: true, updatedDates: [TARGET] });
    assert.deepStrictEqual(worker.quotes()[TARGET], {
      text: 'Usable Bing quote', source: 'Author', caption: '', link: 'https://cn.bing.com/search?q=Author&form=BTQUOT'
    });
    assert.strictEqual(worker.lease().retryLevel, 1, 'the blank caption stays eligible for recovery');
    worker.clock.now += MINUTE;
    assert.strictEqual((await worker.service.requestLease()).scrape, true);
  });

  it('prefers a captioned fallback over a scraped blank caption for a blank-caption quote', async () => {
    const worker = makeWorker({
      quotes: { [TARGET]: quoteOf(TARGET, '') },
      fallback: () => json({ [TARGET]: { text: `Quote ${TARGET}`, source: `Author ${TARGET}`, caption: `Caption ${TARGET}` } })
    });
    const { token } = await worker.service.requestLease();

    await worker.service.submit({ date: TARGET, token, quote: quoteOf(TARGET, '') });

    assert.deepStrictEqual(worker.quotes()[TARGET], quoteOf(TARGET));
  });

  it('keeps at most eight quotes, the latest dates first', async () => {
    const older = Array.from({ length: 8 }, (_, i) => addDays(TARGET, -2 - i));
    const worker = makeWorker({ quotes: Object.fromEntries(older.map(date => [date, quoteOf(date)])) });
    const { token } = await worker.service.requestLease();

    await worker.service.submit({ date: TARGET, token, quote: quoteOf(TARGET) });

    assert.deepStrictEqual(Object.keys(worker.quotes()).sort().reverse(), [TARGET, ...older.slice(0, 7)]);
  });
});
