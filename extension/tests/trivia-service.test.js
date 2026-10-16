import { describe, it } from 'node:test';
import assert from 'node:assert';
import { addDays } from '../src/helpers/date.js';
import { createEmptyCatalog } from '../src/worker/catalog.js';
import { createCatalogService } from '../src/worker/catalog-service.js';
import { STORAGE_KEYS } from '../src/worker/storage-keys.js';
import { createTriviaService } from '../src/worker/trivia-service.js';

const TARGET = '20261015';
const MINUTE = 60 * 1000;
const quiet = { warn() {} };

const triviaIdOf = (date, slug = 'Quiz') => `HPQuiz_${date}_${slug}`;

function entryOf(date, triviaId = triviaIdOf(date)) {
  return {
    date,
    imageId: `OHR.Day${date}_ZH-CN1`,
    triviaId,
    triviaData: null,
    triviaState: 'missing',
    triviaAttemptedAt: 0,
    triviaNextRetryAt: 0,
    triviaRetryLevel: 0
  };
}

// A catalog whose metadata sources already succeeded, so a refresh only
// commits its round start and derives trivia work from the committed entries.
function catalogOf(dates) {
  const catalog = createEmptyCatalog();
  catalog.refreshState.date = TARGET;
  catalog.refreshState.generation = 1;
  for (const source of Object.values(catalog.refreshState.sources)) {
    source.status = 'success';
  }
  for (const date of dates) {
    catalog.entries[date] = entryOf(date);
  }
  return catalog;
}

function makeStorage(initial) {
  const data = structuredClone(initial);
  return {
    data,
    async get(key) {
      const keys = Array.isArray(key) ? key : [key];
      return Object.fromEntries(keys.filter(k => k in data).map(k => [k, structuredClone(data[k])]));
    },
    async set(items) { Object.assign(data, structuredClone(items)); }
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

// Trivia requests stay open until the test settles them by triviaId.
function makeTriviaFetch() {
  const fetches = { calls: [], active: 0, maxActive: 0, open: new Map() };
  fetches.fetch = async (triviaId) => {
    fetches.calls.push(triviaId);
    fetches.active++;
    fetches.maxActive = Math.max(fetches.maxActive, fetches.active);
    const request = deferred();
    fetches.open.set(triviaId, request);
    try {
      return await request.promise;
    } finally {
      fetches.active--;
    }
  };
  // Resolves the parsed trivia response; `data` is its payload.
  fetches.succeed = (triviaId, data = { question: `Q ${triviaId}` }) => fetches.open.get(triviaId).resolve({ data });
  fetches.respond = (triviaId, response) => fetches.open.get(triviaId).resolve(response);
  fetches.fail = triviaId => fetches.open.get(triviaId).reject(new Error('HTTP 500'));
  return fetches;
}

/** Real catalog and trivia services over one storage area, as one worker lifetime. */
function startWorker(storage, clock, fetches = makeTriviaFetch()) {
  const worker = { storage, clock, fetches, broadcasts: [], work: Promise.resolve() };
  let trivia;
  worker.catalog = createCatalogService({
    storage,
    fetchJson: async () => { throw new Error('offline'); },
    now: () => clock.now,
    getTargetDate: () => storage.data[STORAGE_KEYS.catalog].refreshState.date,
    broadcast: message => worker.broadcasts.push(message),
    scheduleTrivia: (candidates) => { worker.work = trivia.schedule(candidates); },
    log: quiet
  });
  trivia = createTriviaService({ catalogService: worker.catalog, fetchTrivia: fetches.fetch, log: quiet });
  worker.entry = date => storage.data[STORAGE_KEYS.catalog].entries[date];
  return worker;
}

function makeWorker(dates) {
  return startWorker(makeStorage({ [STORAGE_KEYS.catalog]: catalogOf(dates) }), { now: 1_000_000 });
}

async function until(condition) {
  for (let i = 0; i < 100 && !condition(); i++) {
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.ok(condition(), 'the expected state was not reached');
}

const retryOf = entry => ({
  triviaState: entry.triviaState,
  triviaRetryLevel: entry.triviaRetryLevel,
  triviaNextRetryAt: entry.triviaNextRetryAt
});

describe('trivia service', () => {
  it('fetches committed target and historical trivia two at a time, newest first, never future entries', async () => {
    const history = [1, 2, 3].map(days => addDays(TARGET, -days));
    const worker = makeWorker([TARGET, ...history, addDays(TARGET, 1)]);

    await worker.catalog.refresh();
    await until(() => worker.fetches.calls.length === 2);
    assert.deepStrictEqual(worker.fetches.calls, [triviaIdOf(TARGET), triviaIdOf(history[0])]);

    for (const date of [TARGET, ...history]) {
      await until(() => worker.fetches.open.has(triviaIdOf(date)));
      worker.fetches.succeed(triviaIdOf(date));
    }
    await worker.work;

    assert.strictEqual(worker.fetches.maxActive, 2);
    assert.deepStrictEqual(worker.fetches.calls, [TARGET, ...history].map(date => triviaIdOf(date)));
    for (const date of [TARGET, ...history]) {
      assert.deepStrictEqual(worker.entry(date).triviaData, { question: `Q ${triviaIdOf(date)}` });
      assert.deepStrictEqual(retryOf(worker.entry(date)),
        { triviaState: 'complete', triviaRetryLevel: 0, triviaNextRetryAt: 0 });
    }
    assert.strictEqual(worker.entry(addDays(TARGET, 1)).triviaState, 'missing');
    assert.ok(worker.broadcasts.some(message =>
      message.type === 'wallpaperCatalogUpdated' && message.dates.includes(TARGET)));
  });

  it('shares one request per triviaId across repeated events and never persists pending', async () => {
    const worker = makeWorker([TARGET]);

    await worker.catalog.refresh();
    await until(() => worker.fetches.calls.length === 1);
    await worker.catalog.refresh();
    await worker.catalog.refresh();

    assert.deepStrictEqual(worker.fetches.calls, [triviaIdOf(TARGET)]);
    assert.strictEqual(worker.entry(TARGET).triviaState, 'missing');
    worker.fetches.succeed(triviaIdOf(TARGET));
    await worker.work;
    assert.strictEqual(worker.entry(TARGET).triviaState, 'complete');
  });

  it('keeps a failed entry missing and retries it after 1, 3, 5 and 5 minutes', async () => {
    const worker = makeWorker([TARGET]);
    const delays = [];

    for (let attempt = 0; attempt < 4; attempt++) {
      await worker.catalog.refresh();
      await until(() => worker.fetches.calls.length === attempt + 1);
      worker.fetches.fail(triviaIdOf(TARGET));
      await worker.work;
      const entry = worker.entry(TARGET);
      assert.strictEqual(entry.triviaState, 'missing');
      delays.push((entry.triviaNextRetryAt - worker.clock.now) / MINUTE);

      // An event inside the backoff window does not retry.
      worker.clock.now = entry.triviaNextRetryAt - 1;
      await worker.catalog.refresh();
      await worker.work;
      assert.strictEqual(worker.fetches.calls.length, attempt + 1);
      worker.clock.now = entry.triviaNextRetryAt;
    }

    assert.deepStrictEqual(delays, [1, 3, 5, 5]);
    assert.strictEqual(worker.entry(TARGET).triviaRetryLevel, 3);

    await worker.catalog.refresh();
    await until(() => worker.fetches.calls.length === 5);
    worker.fetches.succeed(triviaIdOf(TARGET));
    await worker.work;
    assert.deepStrictEqual(retryOf(worker.entry(TARGET)),
      { triviaState: 'complete', triviaRetryLevel: 0, triviaNextRetryAt: 0 });
  });

  it('lets a reconnect bypass one trivia backoff window, keeping and then advancing its level', async () => {
    const worker = makeWorker([TARGET]);
    await worker.catalog.refresh();
    await until(() => worker.fetches.calls.length === 1);
    worker.fetches.fail(triviaIdOf(TARGET));
    await worker.work;
    const failedAt = worker.clock.now;

    worker.clock.now += 10 * 1000;
    const reconnectedAt = worker.clock.now;
    await worker.catalog.refresh({ reconnect: true });
    await until(() => worker.fetches.calls.length === 2);
    assert.strictEqual(worker.entry(TARGET).triviaRetryLevel, 1, 'a bypass keeps the level');
    assert.strictEqual(worker.entry(TARGET).triviaNextRetryAt, failedAt + MINUTE);

    // A duplicate reconnect signal for the same window neither records another
    // bypass nor starts another request.
    worker.clock.now += 1000;
    await worker.catalog.refresh({ reconnect: true });
    assert.strictEqual(worker.fetches.calls.length, 2);
    assert.strictEqual(worker.entry(TARGET).triviaLastReconnectBypassAt, reconnectedAt);

    worker.fetches.fail(triviaIdOf(TARGET));
    await worker.work;
    assert.deepStrictEqual(retryOf(worker.entry(TARGET)),
      { triviaState: 'missing', triviaRetryLevel: 2, triviaNextRetryAt: worker.clock.now + 3 * MINUTE });
    await worker.catalog.refresh();
    await worker.work;
    assert.strictEqual(worker.fetches.calls.length, 2, 'without a reconnect the new window holds');
  });

  it('keeps a recorded reconnect bypass usable after the worker terminates mid-request', async () => {
    const storage = makeStorage({ [STORAGE_KEYS.catalog]: catalogOf([TARGET]) });
    const clock = { now: 1_000_000 };
    const first = startWorker(storage, clock);
    await first.catalog.refresh();
    await until(() => first.fetches.calls.length === 1);
    first.fetches.fail(triviaIdOf(TARGET));
    await first.work;

    clock.now += 10 * 1000;
    const bypassing = startWorker(storage, clock);
    await bypassing.catalog.refresh({ reconnect: true });
    await until(() => bypassing.fetches.calls.length === 1);
    // The worker stops here, before the bypassed attempt records a result.

    const restarted = startWorker(storage, clock);
    await restarted.catalog.refresh();
    await until(() => restarted.fetches.calls.length === 1);
    restarted.fetches.succeed(triviaIdOf(TARGET));
    await restarted.work;
    assert.strictEqual(restarted.entry(TARGET).triviaState, 'complete');
  });

  for (const [label, response] of [
    ['no data', { title: '' }],
    ['null data', { data: null }],
    ['an empty-string payload', { data: '', statusCode: 400 }],
    ['a payload without a question', { data: { options: [] } }]
  ]) {
    it(`keeps an entry missing and backs off when a response has ${label}`, async () => {
      const worker = makeWorker([TARGET]);
      await worker.catalog.refresh();
      await until(() => worker.fetches.calls.length === 1);

      worker.fetches.respond(triviaIdOf(TARGET), response);
      await worker.work;

      assert.deepStrictEqual(retryOf(worker.entry(TARGET)),
        { triviaState: 'missing', triviaRetryLevel: 1, triviaNextRetryAt: worker.clock.now + MINUTE });
      assert.strictEqual(worker.entry(TARGET).triviaData, null);
    });
  }

  for (const outcome of ['success', 'failure']) {
    it(`discards a late ${outcome} once the entry's triviaId has changed`, async () => {
      const worker = makeWorker([TARGET]);
      await worker.catalog.refresh();
      await until(() => worker.fetches.calls.length === 1);

      const replacement = { ...entryOf(TARGET, triviaIdOf(TARGET, 'Other')), triviaRetryLevel: 2, triviaNextRetryAt: 42 };
      worker.storage.data[STORAGE_KEYS.catalog].entries[TARGET] = structuredClone(replacement);
      if (outcome === 'success') worker.fetches.succeed(triviaIdOf(TARGET));
      else worker.fetches.fail(triviaIdOf(TARGET));
      await worker.work;

      assert.deepStrictEqual(worker.entry(TARGET), replacement);
    });
  }

  it('discards a late result whose entry no longer exists', async () => {
    const worker = makeWorker([TARGET]);
    await worker.catalog.refresh();
    await until(() => worker.fetches.calls.length === 1);

    delete worker.storage.data[STORAGE_KEYS.catalog].entries[TARGET];
    worker.fetches.succeed(triviaIdOf(TARGET));
    await worker.work;

    assert.strictEqual(worker.entry(TARGET), undefined);
  });

  it('admits a result for an unchanged triviaId after the refresh generation rolls over', async () => {
    const worker = makeWorker([TARGET]);
    await worker.catalog.refresh();
    await until(() => worker.fetches.calls.length === 1);

    const refreshState = worker.storage.data[STORAGE_KEYS.catalog].refreshState;
    refreshState.date = addDays(TARGET, 1);
    refreshState.generation += 1;
    worker.fetches.succeed(triviaIdOf(TARGET));
    await worker.work;

    assert.strictEqual(worker.entry(TARGET).triviaState, 'complete');
  });

  it('retries trivia left in flight by a terminated worker on the next event', async () => {
    const storage = makeStorage({ [STORAGE_KEYS.catalog]: catalogOf([TARGET]) });
    const clock = { now: 1_000_000 };
    const terminated = startWorker(storage, clock);
    await terminated.catalog.refresh();
    await until(() => terminated.fetches.calls.length === 1);
    // The worker stops here: its request never settles.

    const restarted = startWorker(storage, clock);
    await restarted.catalog.refresh();
    await until(() => restarted.fetches.calls.length === 1);
    restarted.fetches.succeed(triviaIdOf(TARGET));
    await restarted.work;

    assert.strictEqual(restarted.entry(TARGET).triviaState, 'complete');
  });
});
