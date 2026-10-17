import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createCatalogService } from '../src/worker/catalog-service.js';
import { STORAGE_KEYS } from '../src/worker/storage-keys.js';
import { addDays } from '../src/helpers/date.js';

const TARGET = '20260728';
const MINUTE = 60 * 1000;

function idFor(date, variant = 'A') {
  return `OHR.Day${variant}${date}_ZH-CN1`;
}

// ImageOfTheDay response covering `days` dates ending at `target`.
function iotdResponse(target = TARGET, { days = 8, variants = {}, omit = [] } = {}) {
  const images = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(target, -i);
    if (omit.includes(date)) continue;
    const id = idFor(date, variants[date]);
    images.push({
      isoDate: date,
      title: `Title ${date}`,
      caption: `Caption ${date}`,
      description: `Description ${date}`,
      copyright: `© ${date}`,
      clickUrl: `/search?q=${date}`,
      imageUrls: {
        landscape: {
          highDef: `/th?id=${id}_1920x1080.jpg`,
          ultraHighDef: `/th?id=${id}_UHD.jpg`
        }
      }
    });
  }
  return { data: { images } };
}

function modelItem(date, variant) {
  const id = idFor(date, variant);
  return {
    Ssd: date,
    ImageContent: {
      Image: { Url: `https://ts1.tc.mm.bing.net/th?id=${id}_1920x1080.webp` },
      Headline: `Headline ${date}`,
      Title: `Model title ${date}`,
      QuickFact: { MainText: `Fact ${date}` },
      TriviaId: `HPQuiz_${date}_Day${variant || ''}`,
      BackstageUrl: `/backstage/${date}`
    }
  };
}

// Model response: MediaContents for target and six earlier dates, Preload for future dates.
function modelResponse(target = TARGET, { includeTarget = true, futureDays = 3, variants = {} } = {}) {
  const media = [];
  for (let i = includeTarget ? 0 : 1; i < 7; i++) {
    const date = addDays(target, -i);
    media.push(modelItem(date, variants[date]));
  }
  const preload = [];
  for (let i = 1; i <= futureDays; i++) {
    const date = addDays(target, i);
    preload.push(modelItem(date, variants[date]));
  }
  return { MediaContents: media, PreloadMediaContents: preload };
}

function archiveResponse(target = TARGET, { quiz, variant } = {}) {
  const date = addDays(target, -7);
  const id = idFor(date, variant);
  return {
    images: [{
      startdate: addDays(date, -1),
      enddate: date,
      url: `/th?id=${id}_1920x1080.jpg&rf=LaDigue_1920x1080.jpg&pid=hp`,
      urlbase: `/th?id=${id}`,
      copyright: `Archive © ${date}`,
      title: `Archive headline ${date}`,
      quiz: quiz !== undefined
        ? quiz
        : `/search?q=Bing+homepage+quiz&filters=WQOskey:%22HPQuiz_${addDays(date, -1)}_Eighth%22&FORM=HPQUIZ`
    }]
  };
}

function sourceOf(url) {
  if (url.includes('imageoftheday')) return 'imageOfTheDay';
  if (url.includes('/hp/api/model')) return 'model';
  if (url.includes('HPImageArchive')) return 'archive';
  throw new Error(`unexpected url ${url}`);
}

function makeStorage(initial = {}) {
  const data = structuredClone(initial);
  const writtenKeys = [];
  return {
    data,
    writtenKeys,
    async get(key) {
      const keys = Array.isArray(key) ? key : [key];
      const result = {};
      for (const k of keys) {
        if (k in data) result[k] = structuredClone(data[k]);
      }
      return result;
    },
    async set(items) {
      writtenKeys.push(...Object.keys(items));
      Object.assign(data, structuredClone(items));
    }
  };
}

// Each source responds from `responses[source]`: a value, an Error to throw, or a
// function returning either (possibly a promise for delayed responses).
function makeFetch(responses) {
  const calls = [];
  async function fetchJson(url) {
    const source = sourceOf(url);
    calls.push(source);
    let response = responses[source];
    if (typeof response === 'function') response = await response();
    if (response instanceof Error) throw response;
    return structuredClone(response);
  }
  return { fetchJson, calls };
}

function makeHarness({ storage = makeStorage(), responses, target = TARGET, time = 1_000_000 } = {}) {
  const clock = { time, target };
  const fetcher = makeFetch(responses || {
    imageOfTheDay: iotdResponse(target),
    model: modelResponse(target),
    archive: archiveResponse(target)
  });
  const broadcasts = [];
  const triviaSchedules = [];
  const service = createCatalogService({
    storage,
    fetchJson: fetcher.fetchJson,
    now: () => clock.time,
    getTargetDate: () => clock.target,
    broadcast: message => broadcasts.push(message),
    scheduleTrivia: candidates => triviaSchedules.push(candidates),
    log: { warn() {} }
  });
  return { service, storage, fetcher, broadcasts, triviaSchedules, clock };
}

function catalogOf(storage) {
  return storage.data[STORAGE_KEYS.catalog];
}

describe('catalog service refresh', () => {
  it('commits all sources into the unsuffixed v2 catalog', async () => {
    const { service, storage } = makeHarness();
    await service.refresh();

    const catalog = catalogOf(storage);
    assert.strictEqual(STORAGE_KEYS.catalog, 'bing_wallpaper_catalog_v2');
    assert.strictEqual(catalog.version, 2);
    assert.strictEqual(typeof catalog.updatedAt, 'number');
    assert.strictEqual(catalog.refreshState.date, TARGET);
    for (const source of ['imageOfTheDay', 'model', 'archive']) {
      assert.strictEqual(catalog.refreshState.sources[source].status, 'success', source);
    }

    const target = catalog.entries[TARGET];
    assert.strictEqual(target.imageId, idFor(TARGET));
    assert.strictEqual(target.metadataStage, 'iotd');
    assert.deepStrictEqual(target.urls, {
      preview: `https://ts1.tc.mm.bing.net/th?id=${idFor(TARGET)}_640x360.jpg`,
      highDef: `https://ts1.tc.mm.bing.net/th?id=${idFor(TARGET)}_1920x1080.jpg`,
      ultraHighDef: `https://ts1.tc.mm.bing.net/th?id=${idFor(TARGET)}_UHD.jpg`
    });
    assert.strictEqual(target.title, `Title ${TARGET}`);
    assert.strictEqual(target.headline, `Headline ${TARGET}`);
    assert.strictEqual(target.quickFact, `Fact ${TARGET}`);
    assert.strictEqual(target.triviaId, `HPQuiz_${TARGET}_Day`);
    assert.strictEqual(target.triviaState, 'missing');
    assert.strictEqual(typeof target.updatedAt, 'number');

    // Preload contributes transient future entries.
    assert.strictEqual(catalog.entries[addDays(TARGET, 1)].metadataStage, 'preload');

    // Archive fills the eighth day, matched by enddate and identity, with the
    // trivia date segment rewritten to the matched date.
    const eighth = catalog.entries[addDays(TARGET, -7)];
    assert.strictEqual(eighth.metadataStage, 'iotd');
    assert.strictEqual(eighth.headline, `Archive headline ${addDays(TARGET, -7)}`);
    assert.strictEqual(eighth.triviaId, `HPQuiz_${addDays(TARGET, -7)}_Eighth`);
  });
});

describe('refresh sharing and rollover', () => {
  it('shares concurrent refreshes and skips sources already successful for the date', async () => {
    const { service, fetcher } = makeHarness();
    await Promise.all([service.refresh(), service.refresh(), service.refresh()]);
    assert.strictEqual(fetcher.calls.length, 3);

    await service.refresh();
    assert.strictEqual(fetcher.calls.length, 3);
  });

  it('increments the persisted generation and resets source states on a new target date', async () => {
    const { service, storage, fetcher, clock } = makeHarness();
    await service.refresh();
    const firstGeneration = catalogOf(storage).refreshState.generation;

    const nextDate = addDays(TARGET, 1);
    clock.target = nextDate;
    clock.time += 60 * MINUTE;
    // The new date's sources start over and are requested again.
    await service.refresh();
    const catalog = catalogOf(storage);
    assert.strictEqual(catalog.refreshState.date, nextDate);
    assert.strictEqual(catalog.refreshState.generation, firstGeneration + 1);
    assert.strictEqual(fetcher.calls.length, 6);
    // Responses still describe the old date, so coverage is missing at level 1.
    for (const source of ['imageOfTheDay', 'model', 'archive']) {
      assert.strictEqual(catalog.refreshState.sources[source].status, 'missing', source);
      assert.strictEqual(catalog.refreshState.sources[source].retryLevel, 1, source);
    }
    // Rollover keeps the entries still in the new window and drops the date
    // that aged out of its seven historical days.
    assert.strictEqual(catalog.entries[TARGET].imageId, idFor(TARGET));
    assert.strictEqual(catalog.entries[addDays(TARGET, -6)].imageId, idFor(addDays(TARGET, -6)));
    assert.ok(!(addDays(TARGET, -7) in catalog.entries), 'an expired date is not navigable');
    assert.ok(Object.keys(catalog.entries).length <= 15);
  });

  it('keeps at most the target, seven historical and seven future dates however far the target advances', async () => {
    const { service, storage, clock } = makeHarness();
    await service.refresh();

    clock.target = addDays(TARGET, 30);
    clock.time += 60 * MINUTE;
    await service.refresh();

    assert.deepStrictEqual(Object.keys(catalogOf(storage).entries), [], 'every old date aged out');
  });

  it('keeps the persisted generation across a worker restart', async () => {
    const first = makeHarness();
    await first.service.refresh();
    const generation = catalogOf(first.storage).refreshState.generation;

    const restarted = makeHarness({ storage: first.storage, time: first.clock.time });
    await restarted.service.refresh();
    assert.strictEqual(restarted.fetcher.calls.length, 0);
    assert.strictEqual(catalogOf(first.storage).refreshState.generation, generation);
  });
});

describe('per-source retry', () => {
  function staleTargetResponses() {
    return {
      // IOTD and Model are valid but lack the target date; Archive fails outright.
      imageOfTheDay: iotdResponse(addDays(TARGET, -1)),
      model: modelResponse(TARGET, { includeTarget: false }),
      archive: new Error('network down')
    };
  }

  it('records missing coverage and transport failures with independent 1, 3, 5, 5 minute backoff', async () => {
    const { service, storage, fetcher, clock } = makeHarness({ responses: staleTargetResponses() });
    const start = clock.time;
    await service.refresh();
    let sources = catalogOf(storage).refreshState.sources;
    assert.strictEqual(sources.imageOfTheDay.status, 'missing');
    assert.strictEqual(sources.model.status, 'missing');
    assert.strictEqual(sources.archive.status, 'failed');
    assert.strictEqual(sources.imageOfTheDay.nextRetryAt, start + MINUTE);

    // Within the window nothing is requested.
    clock.time = start + MINUTE - 1;
    await service.refresh();
    assert.strictEqual(fetcher.calls.length, 3);

    const delays = [];
    for (const expectedDelay of [3, 5, 5]) {
      clock.time = catalogOf(storage).refreshState.sources.imageOfTheDay.nextRetryAt;
      await service.refresh();
      sources = catalogOf(storage).refreshState.sources;
      delays.push((sources.imageOfTheDay.nextRetryAt - clock.time) / MINUTE);
      assert.strictEqual(sources.model.nextRetryAt - clock.time, expectedDelay * MINUTE);
    }
    assert.deepStrictEqual(delays, [3, 5, 5]);
    assert.strictEqual(sources.imageOfTheDay.retryLevel, 3);
  });

  it('retries only the source whose own window expired', async () => {
    const responses = staleTargetResponses();
    const { service, storage, fetcher, clock } = makeHarness({ responses });
    await service.refresh();
    // Model succeeds on its retry and resets; the others fail again.
    responses.model = modelResponse(TARGET);
    clock.time += MINUTE;
    await service.refresh();
    const sources = catalogOf(storage).refreshState.sources;
    assert.deepStrictEqual(
      { status: sources.model.status, retryLevel: sources.model.retryLevel, nextRetryAt: sources.model.nextRetryAt },
      { status: 'success', retryLevel: 0, nextRetryAt: 0 }
    );
    assert.strictEqual(sources.imageOfTheDay.retryLevel, 2);

    // A successful source is not requested again for the same date.
    clock.time = sources.imageOfTheDay.nextRetryAt;
    const before = fetcher.calls.length;
    await service.refresh();
    assert.deepStrictEqual(fetcher.calls.slice(before).sort(), ['archive', 'imageOfTheDay']);
  });

  it('lets a reconnect bypass one active window per source without resetting its level', async () => {
    const responses = staleTargetResponses();
    const { service, storage, fetcher, clock } = makeHarness({ responses });
    // Each request takes 1 ms, so a failure lands after the reconnect that bypassed it.
    for (const [source, response] of Object.entries(responses)) {
      responses[source] = () => { clock.time += 1; return response; };
    }
    await service.refresh();
    clock.time += 10 * 1000;

    await service.refresh({ reconnect: true });
    assert.strictEqual(fetcher.calls.length, 6);
    // The bypassed attempt failed again, advancing the level.
    assert.strictEqual(catalogOf(storage).refreshState.sources.imageOfTheDay.retryLevel, 2);

    // A further reconnect may bypass the new window once, but not twice.
    clock.time += 1000;
    await service.refresh({ reconnect: true });
    assert.strictEqual(fetcher.calls.length, 9);
    clock.time += 1000;
    await service.refresh({ reconnect: true });
    assert.strictEqual(fetcher.calls.length, 12);
  });

  it('applies a reconnect that arrives while a same-date refresh is running', async () => {
    const responses = staleTargetResponses();
    const { service, fetcher, clock } = makeHarness({ responses });
    await service.refresh();
    clock.time += 1000;

    // After every window expires, a plain refresh is in flight when the reconnect arrives.
    const pending = deferred();
    responses.archive = () => pending.promise;
    clock.time += MINUTE;
    const running = service.refresh();
    const reconnect = service.refresh({ reconnect: true });
    pending.resolve(new Error('still down'));
    await Promise.all([running, reconnect]);
    // The first refresh retried all three expired sources; the reconnect then
    // bypassed the windows those failures opened.
    assert.strictEqual(fetcher.calls.length, 9);
  });

  it('does not bypass twice when the bypassed attempt is still unresolved at restart', async () => {
    const first = makeHarness({ responses: staleTargetResponses() });
    await first.service.refresh();
    first.clock.time += 1000;
    // The bypassed fetch never resolves (worker terminated mid-request).
    first.fetcher.calls.length = 0;
    const hang = new Promise(() => {});
    const hangingResponses = { imageOfTheDay: () => hang, model: () => hang, archive: () => hang };
    const hung = makeHarness({ storage: first.storage, responses: hangingResponses, time: first.clock.time });
    hung.service.refresh({ reconnect: true });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.strictEqual(hung.fetcher.calls.length, 3);

    const restarted = makeHarness({ storage: first.storage, responses: staleTargetResponses(), time: first.clock.time + 1000 });
    await restarted.service.refresh({ reconnect: true });
    assert.strictEqual(restarted.fetcher.calls.length, 0);
    assert.strictEqual(catalogOf(first.storage).refreshState.sources.imageOfTheDay.retryLevel, 1);
  });
});

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

function displayStateFor(date, imageId) {
  return {
    date,
    imageId,
    url: `https://ts1.tc.mm.bing.net/th?id=${imageId}_UHD.jpg`,
    preloadDataUrl: '',
    updatedAt: 1
  };
}

describe('stale refresh generation', () => {
  // Round A (TARGET) commits IOTD but its Model response is delayed until a new
  // target date has rolled the catalog and that round has failed.
  async function runStaleModelScenario(lateModel, { iotdOmit = [] } = {}) {
    const lateResponse = deferred();
    const responses = {
      imageOfTheDay: iotdResponse(TARGET, { omit: iotdOmit }),
      model: () => lateResponse.promise,
      archive: archiveResponse(TARGET)
    };
    const storage = makeStorage({
      [STORAGE_KEYS.displayState]: displayStateFor(TARGET, idFor(TARGET)),
      wallpaper_preload_data_url: 'data:image/jpeg;base64,AAAA'
    });
    const harness = makeHarness({ storage, responses });
    const roundA = harness.service.refresh();
    await new Promise(resolve => setTimeout(resolve, 0));

    harness.clock.target = addDays(TARGET, 1);
    harness.clock.time += MINUTE;
    responses.imageOfTheDay = new Error('offline');
    responses.model = new Error('offline');
    responses.archive = new Error('offline');
    await harness.service.refresh();

    lateResponse.resolve(lateModel);
    await roundA;
    return harness;
  }

  it('drops a displayed-date conflict whole while other candidates in the batch still commit', async () => {
    const { storage } = await runStaleModelScenario(
      modelResponse(TARGET, { variants: { [TARGET]: 'B', [addDays(TARGET, -1)]: 'B' } })
    );
    const entries = catalogOf(storage).entries;

    // Displayed date: candidate B is dropped without merging any field.
    assert.strictEqual(entries[TARGET].imageId, idFor(TARGET));
    assert.strictEqual(entries[TARGET].headline, undefined);
    assert.strictEqual(entries[TARGET].triviaId, '');
    // Existing historical identity is never replaced by a stale round.
    assert.strictEqual(entries[addDays(TARGET, -1)].imageId, idFor(addDays(TARGET, -1)));
    assert.strictEqual(entries[addDays(TARGET, -1)].headline, undefined);
    // Same-identity history is supplemented.
    assert.strictEqual(entries[addDays(TARGET, -2)].headline, `Headline ${addDays(TARGET, -2)}`);
    // Stale results never add future entries.
    assert.strictEqual(entries[addDays(TARGET, 2)], undefined);
  });

  it('only fills missing fields of the same identity without raising its stage', async () => {
    const lateIotd = deferred();
    const responses = {
      imageOfTheDay: () => lateIotd.promise,
      model: modelResponse(TARGET),
      archive: new Error('offline')
    };
    const harness = makeHarness({ responses });
    const roundA = harness.service.refresh();
    await new Promise(resolve => setTimeout(resolve, 0));

    harness.clock.target = addDays(TARGET, 1);
    harness.clock.time += MINUTE;
    responses.imageOfTheDay = new Error('offline');
    responses.model = new Error('offline');
    await harness.service.refresh();

    lateIotd.resolve(iotdResponse(TARGET));
    await roundA;
    const entry = catalogOf(harness.storage).entries[addDays(TARGET, -2)];
    assert.strictEqual(entry.metadataStage, 'media');
    assert.strictEqual(entry.title, `Model title ${addDays(TARGET, -2)}`);
    assert.strictEqual(entry.caption, `Caption ${addDays(TARGET, -2)}`);
  });

  it('adds a missing historical date that is not displayed', async () => {
    const missing = addDays(TARGET, -4);
    const { storage } = await runStaleModelScenario(modelResponse(TARGET), { iotdOmit: [missing] });
    const entry = catalogOf(storage).entries[missing];
    assert.strictEqual(entry.imageId, idFor(missing));
    assert.strictEqual(entry.metadataStage, 'media');
  });

  it('leaves the new round refresh state untouched', async () => {
    const { storage } = await runStaleModelScenario(modelResponse(TARGET));
    const refreshState = catalogOf(storage).refreshState;
    assert.strictEqual(refreshState.date, addDays(TARGET, 1));
    assert.strictEqual(refreshState.generation, 2);
    assert.strictEqual(refreshState.sources.model.status, 'failed');
    assert.strictEqual(refreshState.sources.model.retryLevel, 1);
  });

  it('schedules trivia only from committed entries, never from rejected candidates', async () => {
    const { triviaSchedules } = await runStaleModelScenario(
      modelResponse(TARGET, { variants: { [TARGET]: 'B', [addDays(TARGET, -1)]: 'B' } })
    );
    const scheduled = triviaSchedules.flat().map(candidate => candidate.triviaId);
    assert.ok(!scheduled.some(id => id.endsWith('DayB')), scheduled.join());
    assert.ok(scheduled.includes(`HPQuiz_${addDays(TARGET, -2)}_Day`));
  });

  it('never writes display state or the legacy preload key', async () => {
    const { storage } = await runStaleModelScenario(modelResponse(TARGET));
    assert.deepStrictEqual([...new Set(storage.writtenKeys)], [STORAGE_KEYS.catalog]);
    assert.deepStrictEqual(storage.data[STORAGE_KEYS.displayState], displayStateFor(TARGET, idFor(TARGET)));
    assert.strictEqual(storage.data.wallpaper_preload_data_url, 'data:image/jpeg;base64,AAAA');
  });
});

describe('trivia derivation and notifications', () => {
  it('offers target and historical trivia but not future entries', async () => {
    const { service, triviaSchedules } = makeHarness();
    await service.refresh();
    const latest = triviaSchedules.at(-1);
    const dates = latest.map(candidate => candidate.date);
    assert.strictEqual(dates[0], TARGET);
    assert.ok(dates.includes(addDays(TARGET, -7)));
    assert.ok(!dates.some(date => date > TARGET));
  });

  it('still derives trivia work when every metadata source is already successful', async () => {
    const { service, fetcher, triviaSchedules } = makeHarness();
    await service.refresh();
    triviaSchedules.length = 0;
    await service.refresh();
    assert.strictEqual(fetcher.calls.length, 3);
    assert.ok(triviaSchedules.at(-1).length > 0);
  });

  it('broadcasts the changed dates once per commit and stays quiet when nothing changed', async () => {
    const { service, broadcasts } = makeHarness();
    await service.refresh();
    assert.ok(broadcasts.length > 0);
    for (const message of broadcasts) {
      assert.strictEqual(message.type, 'wallpaperCatalogUpdated');
      assert.strictEqual(new Set(message.dates).size, message.dates.length);
    }
    const allDates = new Set(broadcasts.flatMap(message => message.dates));
    assert.ok(allDates.has(TARGET) && allDates.has(addDays(TARGET, 1)));

    broadcasts.length = 0;
    await service.refresh();
    assert.strictEqual(broadcasts.length, 0);
  });
});

describe('identity and stage rules', () => {
  it('replaces a transient Preload entry when IOTD publishes a different identity', async () => {
    const tomorrow = addDays(TARGET, 1);
    const harness = makeHarness({
      responses: {
        imageOfTheDay: iotdResponse(TARGET),
        model: modelResponse(TARGET, { variants: { [tomorrow]: 'P' } }),
        archive: archiveResponse(TARGET)
      }
    });
    await harness.service.refresh();
    assert.strictEqual(catalogOf(harness.storage).entries[tomorrow].imageId, idFor(tomorrow, 'P'));

    const responses = {
      imageOfTheDay: iotdResponse(tomorrow),
      model: modelResponse(tomorrow),
      archive: archiveResponse(tomorrow)
    };
    const next = makeHarness({ storage: harness.storage, responses, target: tomorrow, time: harness.clock.time + MINUTE });
    await next.service.refresh();

    const entry = catalogOf(harness.storage).entries[tomorrow];
    assert.strictEqual(entry.imageId, idFor(tomorrow));
    assert.strictEqual(entry.metadataStage, 'iotd');
    assert.strictEqual(entry.triviaId, `HPQuiz_${tomorrow}_Day`);
    assert.strictEqual(entry.triviaState, 'missing');
  });

  it('does not let a lower-stage source replace an IOTD identity', async () => {
    const harness = makeHarness({
      responses: {
        imageOfTheDay: iotdResponse(TARGET),
        model: modelResponse(TARGET, { variants: { [TARGET]: 'M' } }),
        archive: archiveResponse(TARGET)
      }
    });
    await harness.service.refresh();
    const entry = catalogOf(harness.storage).entries[TARGET];
    assert.strictEqual(entry.imageId, idFor(TARGET));
    assert.strictEqual(entry.headline, undefined);
  });

  for (const [label, quiz] of [['missing', null], ['empty', ''], ['malformed', '/search?q=quiz&filters=WQOskey:%22NotAQuiz%22']]) {
    it(`stores a ${label} Archive trivia ID as missing and never schedules it`, async () => {
      const warnings = [];
      const eighth = addDays(TARGET, -7);
      const harness = makeHarness({
        responses: {
          imageOfTheDay: iotdResponse(TARGET),
          model: modelResponse(TARGET),
          archive: archiveResponse(TARGET, { quiz })
        }
      });
      const service = createCatalogService({
        storage: harness.storage,
        fetchJson: harness.fetcher.fetchJson,
        now: () => harness.clock.time,
        getTargetDate: () => TARGET,
        scheduleTrivia: candidates => harness.triviaSchedules.push(candidates),
        log: { warn: (...args) => warnings.push(args) }
      });
      await service.refresh();
      const entry = catalogOf(harness.storage).entries[eighth];
      assert.strictEqual(entry.triviaId, '');
      assert.strictEqual(entry.triviaState, 'missing');
      assert.strictEqual(entry.headline, `Archive headline ${eighth}`);
      assert.ok(!harness.triviaSchedules.flat().some(candidate => candidate.date === eighth));
      assert.strictEqual(warnings.length, label === 'malformed' ? 1 : 0);
    });
  }
});

describe('catalog change notification', () => {
  it('reports metadata commits that changed the catalog but not image bookkeeping commits', async () => {
    const storage = makeStorage();
    let changes = 0;
    const fetcher = makeFetch({
      imageOfTheDay: iotdResponse(),
      model: modelResponse(),
      archive: archiveResponse()
    });
    const service = createCatalogService({
      storage,
      fetchJson: fetcher.fetchJson,
      now: () => 1_000_000,
      getTargetDate: () => TARGET,
      onCatalogChanged: () => { changes += 1; },
      log: { warn() {} }
    });
    await service.refresh();
    assert.ok(changes > 0);

    const afterRefresh = changes;
    await service.refresh();
    await service.commitImageState((catalog) => {
      catalog.refreshState.cachedFutureDepth = 3;
      return { changed: true };
    });
    assert.strictEqual(changes, afterRefresh);
    assert.strictEqual(storage.data[STORAGE_KEYS.catalog].refreshState.cachedFutureDepth, 3);
  });
});
