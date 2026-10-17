/**
 * Browser checks of the service worker's wallpaper pipeline in the actual MV3
 * extension: image prefetch order and concurrency, metadata refresh, retries,
 * stale results and worker termination. Bing's metadata, image and trivia
 * responses are served by routes; harness.mjs describes the setup.
 */

import { after, afterEach, before, describe, it } from 'node:test';
import assert from 'node:assert';
import { addDays } from '../../src/helpers/date.js';
import { createEmptyCatalog } from '../../src/worker/catalog.js';
import {
  ANY_METADATA_REQUEST, BOOT_PREVIEW, CATALOG_KEY, COMMITTED_AT, GRADIENT, METADATA_REQUESTS, MINUTE,
  QUOTE_LEASE_KEY, TARGET, TRIVIA_REQUESTS, advanceWorkerClock, backgroundImages, backgroundKinds,
  cachedUrls, catalogOf, catalogWhen, computedBackground, context, day, deferred, deleteCached,
  displayStateWhen, eventually, final, finalHd, finish, headlineIs, imageOfTheDayResponse, modelResponse,
  openNewTab, preview, previous, readLocal, restartWorker, seed, sendMessage, serveImages, serveMetadata, showsFinal,
  snapshotOf, start, stopWorker, updatingText, writeLocal, writeSync
} from './harness.mjs';

const A = day(0, 'Target', '#a03020');
const B = day(-1, 'Older', '#2060a0');
const history = count => Array.from({ length: count }, (_, i) => day(-(i + 1), `History${i + 1}`, '#2060a0'));
const future = count => Array.from({ length: count }, (_, i) => day(i + 1, `Future${i + 1}`, '#208040'));
const QUIZ = { question: 'Where is this?', options: [] };

const finalsOf = days => days.map(shown => shown.urls.ultraHighDef);
const previewsOf = days => days.map(shown => shown.urls.preview);
const sameMembers = (actual, expected) => JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

describe('service worker wallpaper pipeline in the loaded extension', () => {
  before(start);
  after(finish);
  afterEach(async () => {
    await context.unrouteAll({ behavior: 'ignoreErrors' });
    await context.setOffline(false);
  });

  it('fills the 30-key window one request at a time: target, then history, then future, nearest first', async () => {
    const H = history(7);
    const F = future(7);
    await seed({ days: [A, ...H, ...F] });
    const served = await serveImages(() => pause(20));

    await sendMessage({ type: 'refreshWallpaperCatalog' });
    await eventually(() => served.urls.length === 30 && served.active === 0, 'the window was not filled');
    await catalogWhen(catalog => catalog?.refreshState.cachedFutureDepth === 7);

    const phase = days => [...previewsOf(days), ...finalsOf(days)];
    assert.deepStrictEqual(served.urls, [...phase([A]), ...phase(H), ...phase(F)]);
    assert.strictEqual(served.maxActive, 1);
    assert.strictEqual((await cachedUrls()).length, 30);
  });

  it('a cached target date whose three sources succeeded opens with zero metadata requests; an uncovered source is still asked', async () => {
    const requests = [];
    await context.route(ANY_METADATA_REQUEST, (route) => {
      requests.push(route.request().url());
      return route.fulfill({ status: 503, body: '' });
    });
    await seed({ days: [A], displayState: snapshotOf(A, BOOT_PREVIEW), cached: [final(A), preview(A)] });
    const page = await openNewTab();
    await showsFinal(page);
    // Resolves once the page's refresh round has finished too.
    await sendMessage({ type: 'refreshWallpaperCatalog' });
    assert.deepStrictEqual(requests, []);
    await page.close();

    // Cached images do not stand in for a source that has not covered the date.
    const catalog = await readLocal(CATALOG_KEY);
    catalog.refreshState.sources.model.status = 'missing';
    await writeLocal({ [CATALOG_KEY]: catalog });
    const again = await openNewTab();
    await showsFinal(again);
    await sendMessage({ type: 'refreshWallpaperCatalog' });

    assert.strictEqual(requests.length, 1);
    assert.match(requests[0], METADATA_REQUESTS.model);
    await again.close();
  });

  it('cold start online: the gradient shows until the worker has fetched metadata and images, then the final image swaps in once', async () => {
    await seed({ local: { [CATALOG_KEY]: createEmptyCatalog() } });
    await serveMetadata('imageOfTheDay', () => imageOfTheDayResponse([A]));
    await serveMetadata('model', () => modelResponse([A]));
    await serveMetadata('archive', () => 503);
    const firstImage = deferred();
    const checked = deferred();
    const served = await serveImages(async () => {
      firstImage.resolve();
      await checked.promise;
    });

    const page = await openNewTab();
    await firstImage.promise;
    assert.strictEqual(await computedBackground(page), GRADIENT);
    assert.deepStrictEqual(await backgroundKinds(page), [], 'nothing but the gradient while the first image downloads');
    checked.resolve();
    const published = await displayStateWhen(page, snapshot => snapshot?.date === A.date);
    await headlineIs(page, A.headline);

    const images = await backgroundImages(page);
    assert.strictEqual(images.filter(kind => kind === 'final').length, 1, 'one final-image swap');
    assert.strictEqual(images.at(-1), 'final');
    assert.strictEqual(published.url, A.urls.ultraHighDef);
    assert.strictEqual(served.maxActive, 1);
    assert.deepStrictEqual(page.errors, []);
    await page.close();
  });

  it('slow connection: the matching preview shows at once and the final image swaps in once; navigation never shows a preview', async () => {
    await seed({ days: [A, B], cached: [preview(A), preview(B)] });
    const releases = new Map(finalsOf([A, B]).map(url => [url, deferred()]));
    const served = await serveImages(url => releases.get(url)?.promise);

    const page = await openNewTab();
    await eventually(() => served.urls.includes(A.urls.ultraHighDef));
    await page.waitForFunction(() => window.__backgrounds.length === 1);
    assert.deepStrictEqual(await backgroundImages(page), ['preview']);
    releases.get(A.urls.ultraHighDef).resolve();
    await displayStateWhen(page, snapshot => snapshot?.date === A.date);
    assert.deepStrictEqual(await backgroundImages(page), ['preview', 'final']);

    await previous(page);
    await headlineIs(page, await updatingText(page));
    await eventually(() => served.urls.includes(B.urls.ultraHighDef));
    await pause(200);
    assert.deepStrictEqual(await backgroundImages(page), ['preview', 'final'], "the destination's cached preview is not rendered");
    releases.get(B.urls.ultraHighDef).resolve();
    await headlineIs(page, B.headline);
    await displayStateWhen(page, snapshot => snapshot?.date === B.date);

    assert.deepStrictEqual(await backgroundImages(page), ['preview', 'final', 'final']);
    assert.strictEqual(served.maxActive, 1);
    await page.close();
  });

  it('enabling UHD fetches the displayed UHD image, then history, then future, without previews; unreferenced HD images are removed', async () => {
    const days = [A, ...history(2), ...future(2)];
    await seed({
      days,
      sync: { enable_uhd_wallpaper: 'no' },
      displayState: snapshotOf(A, BOOT_PREVIEW, COMMITTED_AT, A.urls.highDef),
      cached: days.flatMap(shown => [preview(shown), finalHd(shown)])
    });
    const served = await serveImages(() => pause(20));

    await writeSync({ enable_uhd_wallpaper: 'yes' });
    await eventually(() => served.urls.length === days.length && served.active === 0, 'the UHD images were not fetched');

    assert.deepStrictEqual(served.urls, finalsOf(days));
    assert.strictEqual(served.maxActive, 1);
    // The displayed HD image stays protected until a page shows its UHD image.
    await eventually(async () => sameMembers(await cachedUrls(), [...previewsOf(days), ...finalsOf(days), A.urls.highDef]),
      'obsolete HD images were not removed');
  });

  it('cachedFutureDepth counts complete future dates, up to 7, and a stale value never stops the repair of a gap', async () => {
    const F = future(7);
    const catalog = catalogOf([A, ...F]);
    catalog.refreshState.cachedFutureDepth = 7;
    const gap = F[2].urls.ultraHighDef;
    await seed({
      days: [A, ...F],
      local: { [CATALOG_KEY]: catalog },
      cached: [A, ...F].flatMap(shown => [preview(shown), final(shown)]).filter(image => image.url !== gap)
    });
    let failing = true;
    const served = await serveImages(() => (failing ? 503 : null));

    await sendMessage({ type: 'refreshWallpaperCatalog' });
    await catalogWhen(stored => stored?.refreshState.cachedFutureDepth === 2, 'the gap did not lower the depth');
    assert.deepStrictEqual(served.urls, [gap], 'the stale depth did not suppress the repair');

    // An evicted preview is a second gap. A reconnect may retry the failed image.
    failing = false;
    const evicted = F[5].urls.preview;
    await deleteCached([evicted]);
    await sendMessage({ type: 'refreshWallpaperCatalog', reconnect: true });
    await catalogWhen(stored => stored?.refreshState.cachedFutureDepth === 7, 'the repaired gaps did not restore the depth');

    assert.deepStrictEqual(served.urls, [gap, evicted, gap]);
  });

  for (const [phase, days] of [['history', history(3)], ['future', future(3)]]) {
    it(`after worker termination during ${phase} prefetch, the next event fetches only the images still missing`, async () => {
      await seed({ days: [A, ...days], cached: [preview(A), final(A)] });
      const interrupted = days[1].urls.preview;
      const held = deferred();
      let holding = true;
      const served = await serveImages(url => (holding && url === interrupted ? held.promise : null));

      await sendMessage({ type: 'refreshWallpaperCatalog' });
      await eventually(() => served.urls.includes(interrupted));
      await stopWorker();
      holding = false;
      held.resolve();
      await eventually(() => served.active === 0);
      assert.ok(!(await cachedUrls()).includes(interrupted), 'the interrupted fetch is not a cache success');

      served.maxActive = 0;
      await sendMessage({ type: 'refreshWallpaperCatalog' });
      await eventually(async () => served.active === 0 && (await cachedUrls()).length === 8, 'the prefetch did not resume');

      assert.deepStrictEqual(served.urls, [days[0].urls.preview, interrupted, interrupted, days[2].urls.preview, ...finalsOf(days)]);
      assert.strictEqual(served.maxActive, 1);
    });
  }

  it('after worker termination during a metadata request, the source stays as it was and the next event asks again', async () => {
    const catalog = catalogOf([A]);
    catalog.refreshState.sources.model.status = 'missing';
    await seed({ days: [A], local: { [CATALOG_KEY]: catalog }, cached: [preview(A), final(A)] });
    const held = deferred();
    const requests = await serveMetadata('model', async () => {
      if (requests.length === 1) await held.promise;
      return modelResponse([A]);
    });

    // Its answer dies with the worker.
    sendMessage({ type: 'refreshWallpaperCatalog' }).catch(() => {});
    await eventually(() => requests.length === 1);
    await stopWorker();
    held.resolve();
    const interrupted = (await readLocal(CATALOG_KEY)).refreshState.sources.model;
    assert.deepStrictEqual([interrupted.status, interrupted.retryLevel, interrupted.attemptedAt], ['missing', 0, 0]);

    await sendMessage({ type: 'refreshWallpaperCatalog' });
    assert.strictEqual(requests.length, 2);
    assert.strictEqual((await readLocal(CATALOG_KEY)).refreshState.sources.model.status, 'success');
  });

  it('after worker termination during a trivia request, the entry stays retryable and the next event fetches it', async () => {
    const triviaId = `HPQuiz_${A.date}_Target`;
    await seed({ days: [{ ...A, triviaId }], cached: [preview(A), final(A)] });
    const held = deferred();
    const triviaIds = [];
    await context.route(TRIVIA_REQUESTS, async (route) => {
      triviaIds.push(new URL(route.request().url()).searchParams.get('id'));
      if (triviaIds.length === 1) await held.promise;
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: QUIZ }) }).catch(() => {});
    });
    const entry = async () => (await readLocal(CATALOG_KEY)).entries[A.date];

    await sendMessage({ type: 'refreshWallpaperCatalog' });
    await eventually(() => triviaIds.length === 1);
    await stopWorker();
    held.resolve();
    const { triviaState, triviaRetryLevel, triviaAttemptedAt } = await entry();
    assert.deepStrictEqual([triviaState, triviaRetryLevel, triviaAttemptedAt], ['missing', 0, 0]);

    await sendMessage({ type: 'refreshWallpaperCatalog' });
    await eventually(async () => (await entry()).triviaState === 'complete', 'the trivia was not fetched again');
    assert.deepStrictEqual(triviaIds, [triviaId, triviaId]);
  });

  it('navigation during future work waits for the active request, then is fetched next, never in parallel', async () => {
    const F = future(2);
    await seed({
      days: [A, B, ...F],
      displayState: snapshotOf(A, BOOT_PREVIEW),
      cached: [A, B].flatMap(shown => [preview(shown), final(shown)])
    });
    const held = deferred();
    const served = await serveImages(url => (url === F[0].urls.preview ? held.promise : null));
    const page = await openNewTab();
    await showsFinal(page);
    await eventually(() => served.urls.includes(F[0].urls.preview));

    // Chrome evicted the older final image meanwhile.
    await deleteCached([B.urls.ultraHighDef]);
    await previous(page);
    await headlineIs(page, await updatingText(page));
    await pause(300);
    assert.deepStrictEqual(served.urls, [F[0].urls.preview], 'the navigation does not start a second request');
    held.resolve();
    await headlineIs(page, B.headline);
    await eventually(() => served.active === 0 && served.urls.length === 5);

    assert.deepStrictEqual(served.urls.slice(0, 2), [F[0].urls.preview, B.urls.ultraHighDef]);
    assert.strictEqual(served.maxActive, 1);
    await page.close();
  });

  it('IOTD without the target date records missing, backs off 1, 3, 5 and 5 minutes, and recovers once the target appears', async () => {
    const catalog = catalogOf([B]);
    catalog.refreshState.sources.imageOfTheDay.status = 'missing';
    await seed({ days: [B], local: { [CATALOG_KEY]: catalog }, cached: [preview(B), final(B)] });
    let published = [B];
    const requests = await serveMetadata('imageOfTheDay', () => imageOfTheDayResponse(published));
    const source = async () => (await readLocal(CATALOG_KEY)).refreshState.sources.imageOfTheDay;

    const windows = [];
    // The first attempt is eligible; each later one is a reconnect bypass.
    for (const reconnect of [false, true, true, true]) {
      await sendMessage({ type: 'refreshWallpaperCatalog', reconnect });
      const state = await source();
      assert.strictEqual(state.status, 'missing');
      windows.push((state.nextRetryAt - state.attemptedAt) / MINUTE);
      // Within the window a plain event does not ask again.
      await sendMessage({ type: 'refreshWallpaperCatalog' });
    }
    assert.deepStrictEqual(windows, [1, 3, 5, 5]);
    assert.strictEqual(requests.length, 4);
    assert.strictEqual((await source()).retryLevel, 3);

    published = [A, B];
    await sendMessage({ type: 'refreshWallpaperCatalog', reconnect: true });
    const recovered = await source();
    assert.deepStrictEqual({ status: recovered.status, retryLevel: recovered.retryLevel, nextRetryAt: recovered.nextRetryAt },
      { status: 'success', retryLevel: 0, nextRetryAt: 0 });
    assert.strictEqual(requests.length, 5);
    assert.strictEqual((await readLocal(CATALOG_KEY)).entries[A.date].imageId, A.imageId);
  });

  // Retry state of the model source, the entry's final image, its trivia and
  // its quote date, as retry levels and window lengths in minutes.
  const retriesOf = async (shown) => {
    const [stored, lease] = [await readLocal(CATALOG_KEY), await readLocal(QUOTE_LEASE_KEY)];
    const entry = stored.entries[shown.date];
    const of = retry => (retry ? { level: retry.retryLevel, window: (retry.nextRetryAt - retry.attemptedAt) / MINUTE } : null);
    return {
      metadata: of(stored.refreshState.sources.model),
      image: of(stored.refreshState.imageFailures[shown.urls.ultraHighDef]),
      trivia: of({ retryLevel: entry.triviaRetryLevel, nextRetryAt: entry.triviaNextRetryAt, attemptedAt: entry.triviaAttemptedAt }),
      quote: of(lease?.retries?.[shown.date])
    };
  };
  const everyRetryAt = (level, window) => ({ metadata: { level, window }, image: { level, window }, trivia: { level, window }, quote: { level, window } });
  // The lease holder's scrape found nothing, and there is no qotd_url fallback.
  const quoteAttempt = async (reconnect, quote = null) => {
    const lease = await sendMessage({ type: 'requestQuoteLease', reconnect });
    if (lease.granted) {
      await sendMessage({ type: 'syncQuotesForImages', date: lease.date, token: lease.token, quote });
    }
    return lease;
  };

  it('metadata, image, trivia and quote retries each back off 1, 3, 5 and 5 minutes, survive a worker restart, and reset on success', async () => {
    const triviaId = `HPQuiz_${A.date}_Target`;
    const catalog = catalogOf([{ ...A, triviaId }]);
    catalog.refreshState.sources.model.status = 'missing';
    // A's final image is missing.
    await seed({ local: { [CATALOG_KEY]: catalog }, cached: [preview(A)] });
    let ok = false;
    const modelRequests = await serveMetadata('model', () => (ok ? modelResponse([A]) : 503));
    const triviaRequests = [];
    await context.route(TRIVIA_REQUESTS, (route) => {
      triviaRequests.push(route.request().url());
      return (ok
        ? route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: QUIZ }) })
        : route.fulfill({ status: 503, body: '' })).catch(() => {});
    });
    const images = await serveImages(() => (ok ? null : 503));
    const retriesAre = async (expected) => {
      await eventually(async () => JSON.stringify(await retriesOf(A)) === JSON.stringify(expected), 'the retries did not settle');
    };
    const attempts = () => [modelRequests.length, triviaRequests.length, images.urls.length];

    // The first attempt is eligible; each later one is a reconnect bypass,
    // which keeps the level until its attempt fails.
    for (const [round, [level, window]] of [[1, 1], [2, 3], [3, 5], [3, 5]].entries()) {
      const reconnect = round > 0;
      await sendMessage({ type: 'refreshWallpaperCatalog', reconnect });
      assert.ok((await quoteAttempt(reconnect)).granted);
      await retriesAre(everyRetryAt(level, window));
      assert.deepStrictEqual(attempts(), [round + 1, round + 1, round + 1]);
    }

    await restartWorker();
    assert.deepStrictEqual(await retriesOf(A), everyRetryAt(3, 5), 'the saturated retries persisted across the restart');
    await sendMessage({ type: 'refreshWallpaperCatalog' });
    assert.strictEqual((await quoteAttempt(false)).granted, false, 'no quote lease within the window');
    await pause(300);
    assert.deepStrictEqual(attempts(), [4, 4, 4], 'nothing is retried within the windows');

    ok = true;
    await sendMessage({ type: 'refreshWallpaperCatalog', reconnect: true });
    assert.ok((await quoteAttempt(true, { text: 'Quote', source: 'Author', caption: 'Caption' })).granted);
    await eventually(async () => {
      const stored = await readLocal(CATALOG_KEY);
      return stored.refreshState.sources.model.status === 'success' && stored.entries[A.date].triviaState === 'complete' &&
        !stored.refreshState.imageFailures[A.urls.ultraHighDef];
    }, 'the retries did not succeed');
    // A completed trivia payload keeps its attempt time; only its level matters.
    const settled = await retriesOf(A);
    assert.deepStrictEqual({ ...settled, trivia: settled.trivia.level },
      { metadata: { level: 0, window: 0 }, image: null, trivia: 0, quote: null });
    assert.deepStrictEqual((await readLocal(CATALOG_KEY)).entries[A.date].triviaData, QUIZ);
  });

  it('a replaced identity restarts only its own retry sequence: image and trivia with a new image for the date, metadata and quote with a new date', async () => {
    const failedAt = Date.now() - 1000;
    const saturated = { attemptedAt: failedAt, nextRetryAt: failedAt + 5 * MINUTE, retryLevel: 3, lastReconnectBypassAt: 0 };
    const catalog = catalogOf([{ ...A, triviaId: `HPQuiz_${A.date}_Target` }]);
    Object.assign(catalog.refreshState.sources.model, { status: 'failed', ...saturated });
    // ImageOfTheDay has not covered the date yet, so the next event asks it.
    catalog.refreshState.sources.imageOfTheDay.status = 'missing';
    catalog.refreshState.imageFailures[A.urls.ultraHighDef] = { ...saturated };
    Object.assign(catalog.entries[A.date], {
      triviaAttemptedAt: failedAt, triviaNextRetryAt: saturated.nextRetryAt, triviaRetryLevel: 3
    });
    await seed({
      local: {
        [CATALOG_KEY]: catalog,
        [QUOTE_LEASE_KEY]: { date: A.date, token: '', leaseUntil: 0, retries: { [A.date]: { ...saturated } } }
      },
      cached: [preview(A)]
    });
    const replacement = day(0, 'Replacement', '#606060');
    const tomorrow = day(1, 'Tomorrow', '#606060');
    let published = [replacement];
    await serveMetadata('imageOfTheDay', () => imageOfTheDayResponse(published));
    await serveMetadata('model', () => 503);
    await serveMetadata('archive', () => 503);
    await serveImages(() => 503);

    // ImageOfTheDay publishes another image for the date.
    await sendMessage({ type: 'refreshWallpaperCatalog' });
    await eventually(async () => {
      const stored = await readLocal(CATALOG_KEY);
      return stored.refreshState.imageFailures[replacement.urls.ultraHighDef] && !stored.refreshState.imageFailures[A.urls.ultraHighDef];
    }, 'the image retry did not move to the new image');
    assert.deepStrictEqual(await retriesOf(replacement), {
      metadata: { level: 3, window: 5 },
      image: { level: 1, window: 1 },
      trivia: { level: 0, window: 0 },
      quote: { level: 3, window: 5 }
    });

    // A new target date with its own image: new source states and a new quote date.
    published = [replacement, tomorrow];
    await advanceWorkerClock(1);
    await sendMessage({ type: 'refreshWallpaperCatalog' });
    const lease = await quoteAttempt(false);
    assert.deepStrictEqual([lease.granted, lease.date], [true, tomorrow.date], 'the new quote date starts without backoff');
    const stored = await readLocal(CATALOG_KEY);
    assert.strictEqual(stored.refreshState.sources.model.retryLevel, 1, 'the new date restarted the model sequence');
    const quoteState = await readLocal(QUOTE_LEASE_KEY);
    assert.deepStrictEqual([quoteState.date, quoteState.retries[tomorrow.date].retryLevel], [tomorrow.date, 1]);
    assert.strictEqual(quoteState.retries[A.date].retryLevel, 3, 'the new date leaves the earlier quote date sequence alone');
    assert.strictEqual(stored.refreshState.imageFailures[replacement.urls.ultraHighDef].retryLevel, 1,
      'the date change leaves the image sequence alone');
  });

  it('a stale Model response after date rollover only supplements history; candidates for the displayed date or the new target contribute nothing', async () => {
    const tomorrow = { ...day(1, 'Tomorrow', '#606060'), triviaId: `HPQuiz_${addDays(TARGET, 1)}_Tomorrow` };
    const replacement = { ...day(0, 'Replacement', '#606060'), triviaId: `HPQuiz_${TARGET}_Replacement` };
    const missing = { ...day(-3, 'Missing', '#606060'), triviaId: `HPQuiz_${addDays(TARGET, -3)}_Missing` };
    const catalog = catalogOf([A, B]);
    catalog.refreshState.sources.model.status = 'missing';
    await seed({
      days: [A, B],
      local: { [CATALOG_KEY]: catalog },
      displayState: snapshotOf(A, BOOT_PREVIEW),
      cached: [A, B].flatMap(shown => [preview(shown), final(shown)])
    });
    const firstModel = deferred();
    const release = deferred();
    let modelCalls = 0;
    await serveMetadata('model', async () => {
      modelCalls += 1;
      if (modelCalls > 1) return 503;
      firstModel.resolve();
      await release.promise;
      return modelResponse([replacement, { ...B, description: 'Stale description' }, missing], [tomorrow]);
    });
    await serveMetadata('imageOfTheDay', () => 503);
    await serveMetadata('archive', () => 503);
    const triviaIds = [];
    await context.route(TRIVIA_REQUESTS, (route) => {
      triviaIds.push(new URL(route.request().url()).searchParams.get('id'));
      return route.fulfill({ status: 503, body: '' }).catch(() => {});
    });

    const staleRound = sendMessage({ type: 'refreshWallpaperCatalog' });
    await firstModel.promise;
    await advanceWorkerClock(1);
    // The next round rolls the catalog to tomorrow; its sources fail.
    await sendMessage({ type: 'refreshWallpaperCatalog' });
    release.resolve();
    await staleRound;

    const stored = await readLocal(CATALOG_KEY);
    assert.deepStrictEqual([stored.refreshState.date, stored.refreshState.generation], [tomorrow.date, 2]);
    assert.strictEqual(stored.refreshState.sources.model.status, 'failed', "the new round's source state is kept");
    assert.deepStrictEqual([stored.entries[A.date].imageId, stored.entries[A.date].headline], [A.imageId, A.headline]);
    assert.strictEqual(stored.entries[A.date].triviaId, '', 'the displayed date takes no field from another identity');
    assert.strictEqual(stored.entries[tomorrow.date], undefined, 'stale work never adds the new target date');
    assert.strictEqual(stored.entries[missing.date].imageId, missing.imageId, 'a missing historical date is added');
    assert.deepStrictEqual([stored.entries[B.date].imageId, stored.entries[B.date].description], [B.imageId, 'Stale description']);

    // Only the committed candidate schedules trivia; quote work follows the committed dates.
    await eventually(() => triviaIds.includes(missing.triviaId));
    await pause(300);
    assert.deepStrictEqual(triviaIds, [missing.triviaId]);
    const lease = await sendMessage({ type: 'requestQuoteLease' });
    assert.deepStrictEqual([lease.granted, lease.date], [true, A.date]);
  });

  it('a delayed trivia result never mutates an entry whose triviaId changed, and survives a rollover that keeps the triviaId', async () => {
    const [first, second, third] = ['First', 'Second', 'Third'].map(slug => `HPQuiz_${A.date}_${slug}`);
    await seed({ days: [{ ...A, triviaId: first }], cached: [preview(A), final(A)] });
    const answers = new Map([first, second, third].map(id => [id, deferred()]));
    const triviaIds = [];
    await context.route(TRIVIA_REQUESTS, async (route) => {
      const id = new URL(route.request().url()).searchParams.get('id');
      triviaIds.push(id);
      const ok = await answers.get(id).promise;
      await (ok
        ? route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: QUIZ }) })
        : route.fulfill({ status: 503, body: '' })).catch(() => {});
    });
    const entry = async () => (await readLocal(CATALOG_KEY)).entries[A.date];
    // Stands in for a worker metadata commit that gives the entry a new trivia ID.
    const replaceTriviaId = async (triviaId) => {
      const catalog = await readLocal(CATALOG_KEY);
      catalog.entries[A.date].triviaId = triviaId;
      await writeLocal({ [CATALOG_KEY]: catalog });
    };
    const untouched = triviaId => ({ triviaId, triviaState: 'missing', triviaData: null, triviaRetryLevel: 0, triviaAttemptedAt: 0 });
    const triviaFields = ({ triviaId, triviaState, triviaData, triviaRetryLevel, triviaAttemptedAt }) =>
      ({ triviaId, triviaState, triviaData, triviaRetryLevel, triviaAttemptedAt });

    // A late success and a late failure for replaced IDs.
    for (const [requested, replacedBy, ok] of [[first, second, true], [second, third, false]]) {
      await sendMessage({ type: 'refreshWallpaperCatalog' });
      await eventually(() => triviaIds.includes(requested));
      await replaceTriviaId(replacedBy);
      answers.get(requested).resolve(ok);
      await pause(500);
      assert.deepStrictEqual(triviaFields(await entry()), untouched(replacedBy));
    }

    // Generation rollover alone does not reject an unchanged triviaId.
    await sendMessage({ type: 'refreshWallpaperCatalog' });
    await eventually(() => triviaIds.includes(third));
    await advanceWorkerClock(1);
    await sendMessage({ type: 'refreshWallpaperCatalog' });
    assert.strictEqual((await readLocal(CATALOG_KEY)).refreshState.generation, 2);
    answers.get(third).resolve(true);
    await eventually(async () => (await entry()).triviaState === 'complete', 'the result was not admitted');

    assert.deepStrictEqual((await entry()).triviaData, QUIZ);
    assert.deepStrictEqual(triviaIds, [first, second, third]);
  });
});
