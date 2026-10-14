import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createWallpaperController, deriveEntryView } from '../src/page/wallpaper-controller.js';

const TARGET = '20261013';
const OLDER = '20261012';
const OLDEST = '20261011';
const ID_A = 'OHR.Target_ZH-CN1000000001';
const ID_B = 'OHR.Older_ZH-CN1000000002';
const ID_C = 'OHR.Oldest_ZH-CN1000000003';

function entry(date, imageId) {
  return {
    date,
    imageId,
    urls: {
      preview: `https://ts1.tc.mm.bing.net/th?id=${imageId}_640x360.jpg`,
      highDef: `https://ts1.tc.mm.bing.net/th?id=${imageId}_1920x1080.jpg`,
      ultraHighDef: `https://ts1.tc.mm.bing.net/th?id=${imageId}_UHD.jpg`
    }
  };
}

const A = entry(TARGET, ID_A);
const B = entry(OLDER, ID_B);
const C = entry(OLDEST, ID_C);

function snapshotOf(shown, overrides = {}) {
  return {
    date: shown.date,
    imageId: shown.imageId,
    url: shown.urls.ultraHighDef,
    preloadDataUrl: '',
    updatedAt: 42,
    ...overrides
  };
}

const dataUrlOf = url => `data:image/jpeg;base64,${Buffer.from(url).toString('base64')}`;
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

function gate() {
  let open;
  const promise = new Promise(resolve => { open = resolve; });
  return { promise, open };
}

/**
 * The controller against an in-memory catalog, display state and image cache.
 * `cached` lists the canonical URLs Cache Storage holds.
 */
function makeHarness({ entries = [A, B, C], targetDate = TARGET, displayState = null, enableUhd = 'yes', cached = [] } = {}) {
  const h = {
    catalog: {
      version: 2,
      refreshState: { date: targetDate },
      entries: Object.fromEntries(entries.map(item => [item.date, item]))
    },
    displayState,
    enableUhd,
    cache: new Set(cached),
    writes: [],
    requests: [],
    finals: [],
    previews: [],
    refreshed: [],
    updating: 0,
    fallbacks: 0,
    clock: 1000,
    // The day the snapshots of these tests were committed (updatedAt 42).
    today: '19700101',
    onRequest: null,
    beforeApplyFinal: null,
    beforeDataUrl: null,
    beforeReadCatalog: null,
    beforeReadDisplayState: null,
    undecodable: new Set()
  };
  h.controller = createWallpaperController({
    readCatalog: async () => {
      await h.beforeReadCatalog?.();
      return h.catalog;
    },
    readDisplayState: async () => {
      await h.beforeReadDisplayState?.();
      return h.displayState;
    },
    writeDisplayState: async (snapshot) => {
      h.writes.push(snapshot);
      h.displayState = snapshot;
    },
    matchImage: async url => (h.cache.has(url) ? url : null),
    toDataUrl: async (blob) => {
      await h.beforeDataUrl?.();
      return dataUrlOf(blob);
    },
    requestImage: async (request) => {
      h.requests.push(request);
      await h.onRequest?.(request);
    },
    readUhdSetting: async () => h.enableUhd,
    now: () => h.clock,
    getTargetDate: () => h.today,
    view: {
      applyFinal: async ({ view, isCurrent }) => {
        await h.beforeApplyFinal?.(view);
        if (h.undecodable.has(view.url) || !isCurrent()) return false;
        h.finals.push(view.date);
        return true;
      },
      applyPreview: ({ view }) => h.previews.push(view.date),
      refreshContents: ({ view }) => h.refreshed.push(view.date),
      showUpdating: () => { h.updating += 1; },
      showFallback: () => { h.fallbacks += 1; }
    },
    log: { warn() {} }
  });
  /** The worker completes each request by caching the requested image. */
  h.workerCachesRequests = () => {
    h.onRequest = ({ date, resolution }) => h.cache.add(h.catalog.entries[date].urls[resolution]);
  };
  return h;
}

describe('deriveEntryView', () => {
  it('projects the configured final resolution and the preview URL', () => {
    assert.deepStrictEqual(deriveEntryView(A, true), {
      date: TARGET, imageId: ID_A, url: A.urls.ultraHighDef, previewUrl: A.urls.preview
    });
    assert.strictEqual(deriveEntryView(A, false).url, A.urls.highDef);
  });

  it('rejects a missing entry, missing URLs or an invalid identity', () => {
    assert.strictEqual(deriveEntryView(undefined, true), null);
    assert.strictEqual(deriveEntryView({ date: TARGET, imageId: ID_A }, true), null);
    assert.strictEqual(deriveEntryView({ ...A, imageId: 'not-an-identity' }, true), null);
  });
});

describe('new tab initialization', () => {
  it('applies a cached target final image at once and publishes it with its preview', async () => {
    const h = makeHarness({ cached: [A.urls.ultraHighDef, A.urls.preview] });

    const result = await h.controller.initialize();

    assert.strictEqual(result.applied, true);
    assert.deepStrictEqual(h.finals, [TARGET]);
    assert.deepStrictEqual(h.requests, [], 'cached images need no worker request');
    assert.deepStrictEqual(h.displayState, {
      date: TARGET,
      imageId: ID_A,
      url: A.urls.ultraHighDef,
      preloadDataUrl: dataUrlOf(A.urls.preview),
      updatedAt: 1000
    });
  });

  it('shows the matching cached preview, requests the final image and swaps once', async () => {
    const h = makeHarness({ cached: [A.urls.preview] });
    h.onRequest = () => {
      assert.deepStrictEqual(h.previews, [TARGET], 'the preview renders before the final image arrives');
      assert.deepStrictEqual(h.writes, [], 'a preview is temporary and publishes nothing');
      h.cache.add(A.urls.ultraHighDef);
    };

    const result = await h.controller.initialize();

    assert.strictEqual(result.applied, true);
    assert.deepStrictEqual(h.requests, [{ date: TARGET, resolution: 'ultraHighDef' }]);
    assert.deepStrictEqual(h.finals, [TARGET], 'one final-image swap');
    assert.strictEqual(h.writes.length, 1);
    assert.strictEqual(h.fallbacks, 0);
  });

  it('keeps the temporary preview when the final image does not arrive', async () => {
    const h = makeHarness({ cached: [A.urls.preview] });

    const result = await h.controller.initialize();

    assert.strictEqual(result.applied, false);
    assert.deepStrictEqual(h.previews, [TARGET]);
    assert.strictEqual(h.fallbacks, 0, 'the fallback does not replace the preview');
    assert.deepStrictEqual(h.writes, []);
  });

  it('shows the fallback when neither image is available', async () => {
    const h = makeHarness();

    const result = await h.controller.initialize();

    assert.strictEqual(result.applied, false);
    assert.strictEqual(h.fallbacks, 1);
    assert.deepStrictEqual(h.writes, []);
  });

  it('shows the fallback without error when Bing has not published the target date', async () => {
    const h = makeHarness({ entries: [B, C] });

    const result = await h.controller.initialize();

    assert.deepStrictEqual(result, { applied: false, reason: 'target not published' });
    assert.strictEqual(h.fallbacks, 1);
    assert.deepStrictEqual(h.requests, []);
  });

  it('starts from the committed snapshot, not the target date, without publishing again', async () => {
    const committed = snapshotOf(B, { preloadDataUrl: dataUrlOf(B.urls.preview) });
    const h = makeHarness({ displayState: committed, cached: [B.urls.ultraHighDef, A.urls.ultraHighDef] });

    await h.controller.initialize();

    assert.deepStrictEqual(h.finals, [OLDER]);
    assert.deepStrictEqual(h.writes, [], 'showing the committed snapshot is not a new application');
  });

  it("does not replace another tab's later commit while showing the snapshot it started from", async () => {
    const h = makeHarness({ displayState: snapshotOf(B), cached: [B.urls.ultraHighDef, B.urls.preview] });
    const decoding = gate();
    h.beforeApplyFinal = () => decoding.promise;

    const initializing = h.controller.initialize();
    await settle();
    const later = snapshotOf(C, { updatedAt: 99 });
    h.displayState = later;
    decoding.open();
    await initializing;

    assert.deepStrictEqual(h.finals, [OLDER], 'this tab still shows what it started from');
    assert.deepStrictEqual(h.displayState, later, 'and tabs opened later initialize from the later commit');
  });

  it('repairs an empty preview from Cache Storage and keeps the application timestamp', async () => {
    const h = makeHarness({ displayState: snapshotOf(B), cached: [B.urls.ultraHighDef, B.urls.preview] });

    await h.controller.initialize();

    assert.deepStrictEqual(h.displayState, snapshotOf(B, { preloadDataUrl: dataUrlOf(B.urls.preview) }));
    assert.deepStrictEqual(h.requests, []);
  });

  it('asks the worker for a missing preview and repairs the snapshot when it is cached', async () => {
    const h = makeHarness({ displayState: snapshotOf(B), cached: [B.urls.ultraHighDef] });
    h.workerCachesRequests();

    await h.controller.initialize();
    await settle();

    assert.deepStrictEqual(h.requests, [{ date: OLDER, resolution: 'preview' }]);
    assert.deepStrictEqual(h.displayState, snapshotOf(B, { preloadDataUrl: dataUrlOf(B.urls.preview) }));
  });

  it('applies the configured resolution of the committed date after a resolution change', async () => {
    const committed = snapshotOf(B, { url: B.urls.highDef, preloadDataUrl: dataUrlOf(B.urls.preview) });
    const h = makeHarness({ displayState: committed, cached: [B.urls.ultraHighDef] });

    await h.controller.initialize();

    assert.deepStrictEqual(h.finals, [OLDER]);
    assert.deepStrictEqual(h.displayState, {
      date: OLDER,
      imageId: ID_B,
      url: B.urls.ultraHighDef,
      preloadDataUrl: dataUrlOf(B.urls.preview),
      updatedAt: 1000
    }, 'the same identity keeps its stored preview');
  });

  it('repairs the empty committed preview while its final image is still unavailable', async () => {
    const h = makeHarness({ displayState: snapshotOf(B), cached: [B.urls.preview] });

    const result = await h.controller.initialize();
    await settle();

    assert.strictEqual(result.applied, false);
    assert.deepStrictEqual(h.previews, [OLDER]);
    assert.deepStrictEqual(h.displayState, snapshotOf(B, { preloadDataUrl: dataUrlOf(B.urls.preview) }));
  });

  it('applies a cached final image without waiting for its preview conversion', async () => {
    const h = makeHarness({ displayState: snapshotOf(B), cached: [B.urls.ultraHighDef, B.urls.preview] });
    const converting = gate();
    h.beforeDataUrl = () => converting.promise;

    const initializing = h.controller.initialize();
    await settle();
    assert.deepStrictEqual(h.finals, [OLDER], 'the final image is on screen while the preview is still converting');
    converting.open();
    await initializing;

    assert.strictEqual(h.displayState.preloadDataUrl, dataUrlOf(B.urls.preview));
  });

  describe('when the catalog no longer maps the committed date to the committed identity', () => {
    const corrected = entry(OLDER, 'OHR.Corrected_ZH-CN1000000005');
    const committed = snapshotOf(B, { preloadDataUrl: dataUrlOf(B.urls.preview) });

    it('still starts from the committed image while its final image is cached', async () => {
      const h = makeHarness({
        entries: [A, corrected],
        displayState: committed,
        cached: [B.urls.ultraHighDef, A.urls.ultraHighDef, corrected.urls.ultraHighDef]
      });

      const result = await h.controller.initialize();

      assert.strictEqual(result.applied, true);
      assert.deepStrictEqual(h.finals, [OLDER]);
      assert.deepStrictEqual(h.displayState, committed);
    });

    it('still starts from the committed image when its date left the catalog', async () => {
      const h = makeHarness({ entries: [A], displayState: committed, cached: [B.urls.ultraHighDef, A.urls.ultraHighDef] });

      await h.controller.initialize();

      assert.deepStrictEqual(h.finals, [OLDER]);
      assert.deepStrictEqual(h.displayState, committed);
      assert.deepStrictEqual(h.requests, [], 'an image outside the catalog cannot be requested from the worker');
    });

    it('shows the corrected image of the committed date when the committed one is not cached', async () => {
      const h = makeHarness({ entries: [A, corrected], displayState: committed, cached: [A.urls.ultraHighDef] });
      h.workerCachesRequests();

      await h.controller.initialize();
      await settle();

      assert.deepStrictEqual(h.finals, [OLDER]);
      assert.strictEqual(h.displayState.imageId, corrected.imageId);
      assert.strictEqual(h.displayState.url, corrected.urls.ultraHighDef);
      assert.notStrictEqual(h.displayState.preloadDataUrl, committed.preloadDataUrl, "the committed image's preview is not kept");
    });

    it('shows the committed preview and repairs it when only the preview is cached and the date left the catalog', async () => {
      const h = makeHarness({ entries: [A], displayState: snapshotOf(B), cached: [B.urls.preview] });

      const result = await h.controller.initialize();

      assert.strictEqual(result.applied, false);
      assert.deepStrictEqual(h.previews, [OLDER]);
      assert.deepStrictEqual(h.finals, []);
      assert.strictEqual(h.fallbacks, 0);
      assert.deepStrictEqual(h.requests, [], 'the target date is not requested in its place');
      assert.deepStrictEqual(h.displayState, snapshotOf(B, { preloadDataUrl: dataUrlOf(B.urls.preview) }));
    });

    it('shows the committed preview instead of the corrected image when only the preview is cached', async () => {
      const h = makeHarness({
        entries: [A, corrected],
        displayState: snapshotOf(B),
        cached: [B.urls.preview, corrected.urls.ultraHighDef]
      });

      await h.controller.initialize();

      assert.deepStrictEqual(h.previews, [OLDER]);
      assert.deepStrictEqual(h.finals, [], 'no other final image is applied or published');
      assert.deepStrictEqual(h.displayState, snapshotOf(B, { preloadDataUrl: dataUrlOf(B.urls.preview) }));
    });

    it('falls back to the target date when neither is available', async () => {
      const h = makeHarness({ entries: [A], displayState: committed, cached: [A.urls.ultraHighDef] });

      await h.controller.initialize();

      assert.deepStrictEqual(h.finals, [TARGET]);
      assert.strictEqual(h.displayState.imageId, ID_A);
      assert.strictEqual(h.displayState.preloadDataUrl, '');
    });
  });
});

describe('navigation', () => {
  async function initialized(options) {
    const h = makeHarness({ cached: [A.urls.ultraHighDef, B.urls.ultraHighDef, C.urls.ultraHighDef], ...options });
    await h.controller.initialize();
    return h;
  }

  it('moves over the actual current and historical entries and wraps in both directions', async () => {
    const future = entry('20261014', 'OHR.Future_ZH-CN1000000004');
    const h = await initialized({ entries: [A, B, C, future] });

    await h.controller.navigate(1);
    await h.controller.navigate(1);
    await h.controller.navigate(1);
    await h.controller.navigate(-1);

    assert.deepStrictEqual(h.finals, [TARGET, OLDER, OLDEST, TARGET, OLDEST]);
    assert.strictEqual(h.displayState.date, OLDEST);
  });

  it('does not cancel a startup that is still reading when a click has nowhere to go', async () => {
    const h = makeHarness({ entries: [], displayState: snapshotOf(B), cached: [B.urls.ultraHighDef] });
    const reading = gate();
    h.beforeReadCatalog = () => reading.promise;
    const initializing = h.controller.initialize();
    await settle();
    h.beforeReadCatalog = null;

    const click = await h.controller.navigate(1);
    reading.open();
    const started = await initializing;

    assert.deepStrictEqual(click, { applied: false, reason: 'not navigable' });
    assert.strictEqual(started.applied, true);
    assert.deepStrictEqual(h.finals, [OLDER]);
  });

  it('does nothing when there are no entries', async () => {
    const h = makeHarness({ entries: [] });

    assert.strictEqual((await h.controller.navigate(1)).applied, false);
    assert.deepStrictEqual(h.requests, []);
  });

  it('keeps the current image under an updating headline and never renders the destination preview', async () => {
    const h = await initialized({ cached: [A.urls.ultraHighDef, A.urls.preview, B.urls.preview] });
    const published = h.displayState;
    const fetching = gate();
    h.onRequest = async () => {
      await fetching.promise;
      h.cache.add(B.urls.ultraHighDef);
    };

    const navigating = h.controller.navigate(1);
    await settle();
    assert.strictEqual(h.updating, 1);
    assert.deepStrictEqual(h.finals, [TARGET]);
    assert.deepStrictEqual(h.displayState, published, 'a pending destination is not published');
    fetching.open();
    await navigating;

    assert.deepStrictEqual(h.previews, []);
    assert.deepStrictEqual(h.requests, [{ date: OLDER, resolution: 'ultraHighDef' }]);
    assert.deepStrictEqual(h.finals, [TARGET, OLDER]);
    assert.strictEqual(h.displayState.date, OLDER);
  });

  it('publishes the destination only after its final image is applied', async () => {
    const h = await initialized();
    const decoding = gate();
    h.beforeApplyFinal = () => decoding.promise;

    const navigating = h.controller.navigate(1);
    await settle();
    assert.strictEqual(h.displayState.date, TARGET);
    decoding.open();
    await navigating;

    assert.strictEqual(h.displayState.date, OLDER);
  });

  it('leaves the image, snapshot and headline of the current date when the destination fails', async () => {
    const h = await initialized({ cached: [A.urls.ultraHighDef] });
    const published = h.displayState;

    const result = await h.controller.navigate(1);

    assert.strictEqual(result.applied, false);
    assert.deepStrictEqual(h.finals, [TARGET]);
    assert.deepStrictEqual(h.displayState, published);
    assert.deepStrictEqual(h.refreshed, [TARGET], 'the updating headline is withdrawn');
  });

  it("publishes an empty preview rather than the previous image's preview", async () => {
    const h = await initialized({ cached: [A.urls.ultraHighDef, A.urls.preview, B.urls.ultraHighDef] });

    await h.controller.navigate(1);

    assert.strictEqual(h.displayState.imageId, ID_B);
    assert.strictEqual(h.displayState.preloadDataUrl, '');
  });

  it('rejects an older click whose catalog read finishes after a newer click', async () => {
    const h = await initialized();
    const reading = gate();
    h.beforeReadCatalog = () => reading.promise;
    const older = h.controller.navigate(1);
    await settle();
    h.beforeReadCatalog = null;

    await h.controller.navigate(-1);
    reading.open();
    const result = await older;

    assert.strictEqual(result.applied, false);
    assert.deepStrictEqual(h.finals, [TARGET, OLDEST]);
    assert.strictEqual(h.displayState.date, OLDEST);
  });

  it('records applications in order when an earlier snapshot write is still in flight', async () => {
    const h = await initialized();
    const reading = gate();
    h.beforeReadDisplayState = () => reading.promise;
    const first = h.controller.navigate(1);
    await settle();
    assert.deepStrictEqual(h.finals, [TARGET, OLDER]);
    h.beforeReadDisplayState = null;

    const second = h.controller.navigate(1);
    await settle();
    reading.open();
    await Promise.all([first, second]);

    assert.deepStrictEqual(h.finals, [TARGET, OLDER, OLDEST]);
    assert.deepStrictEqual(h.writes.map(snapshot => snapshot.date), [TARGET, OLDER, OLDEST]);
    assert.strictEqual(h.displayState.date, OLDEST, 'the snapshot ends on the image the page shows');
  });

  it('keeps the current image and snapshot when the destination image cannot be decoded', async () => {
    const h = await initialized();
    const published = h.displayState;
    h.undecodable.add(B.urls.ultraHighDef);

    const result = await h.controller.navigate(1);

    assert.deepStrictEqual(result, { applied: false, reason: 'decode failed' });
    assert.deepStrictEqual(h.finals, [TARGET]);
    assert.deepStrictEqual(h.displayState, published);
    assert.deepStrictEqual(h.refreshed, [TARGET], 'the current headline is restored');
  });

  it('rejects a click whose catalog read finishes after a newer startup', async () => {
    const h = await initialized();
    const reading = gate();
    h.beforeReadCatalog = () => reading.promise;
    const older = h.controller.navigate(1);
    await settle();
    h.beforeReadCatalog = null;
    // Another tab commits the oldest date, and this page initializes again.
    h.displayState = snapshotOf(C);
    await h.controller.initialize();

    reading.open();
    const result = await older;

    assert.deepStrictEqual(result, { applied: false, reason: 'superseded' });
    assert.deepStrictEqual(h.finals, [TARGET, OLDEST]);
    assert.strictEqual(h.displayState.date, OLDEST);
  });

  it('does not let a superseded navigation apply or publish after a newer one', async () => {
    const h = await initialized({ cached: [A.urls.ultraHighDef, C.urls.ultraHighDef] });
    const fetchingOlder = gate();
    h.onRequest = async ({ date }) => {
      if (date === OLDER) {
        await fetchingOlder.promise;
        h.cache.add(B.urls.ultraHighDef);
      }
    };

    const superseded = h.controller.navigate(1);
    await settle();
    await h.controller.navigate(-1);
    fetchingOlder.open();
    const result = await superseded;

    assert.strictEqual(result.applied, false);
    assert.deepStrictEqual(h.finals, [TARGET, OLDEST]);
    assert.strictEqual(h.displayState.date, OLDEST);
  });
});

describe('catalog update notifications', () => {
  it('re-renders the displayed entry without applying its image or publishing again', async () => {
    const h = makeHarness({ cached: [A.urls.ultraHighDef, A.urls.preview] });
    await h.controller.initialize();
    const published = h.displayState;
    h.clock = 2000;

    await h.controller.catalogUpdated([TARGET]);

    assert.deepStrictEqual(h.refreshed, [TARGET]);
    assert.deepStrictEqual(h.finals, [TARGET]);
    assert.deepStrictEqual(h.displayState, published);
  });

  it('ignores a notification for dates the page does not display', async () => {
    const h = makeHarness({ cached: [A.urls.ultraHighDef] });
    await h.controller.initialize();

    await h.controller.catalogUpdated([OLDER]);

    assert.deepStrictEqual(h.refreshed, []);
  });

  it('waits for the final image of a corrected identity, then replaces the whole display', async () => {
    const h = makeHarness({ cached: [A.urls.ultraHighDef, A.urls.preview] });
    await h.controller.initialize();
    const corrected = entry(TARGET, 'OHR.Corrected_ZH-CN1000000005');
    h.catalog.entries[TARGET] = corrected;
    h.workerCachesRequests();

    await h.controller.catalogUpdated([TARGET]);

    assert.deepStrictEqual(h.finals, [TARGET, TARGET]);
    assert.strictEqual(h.displayState.imageId, corrected.imageId);
    assert.strictEqual(h.displayState.url, corrected.urls.ultraHighDef);
    assert.strictEqual(h.displayState.preloadDataUrl, '');
  });

  it('shows the target once the catalog provides it to a page that had nothing to display', async () => {
    const h = makeHarness({ entries: [] });
    await h.controller.initialize();
    h.catalog.entries[TARGET] = A;
    h.workerCachesRequests();

    await h.controller.catalogUpdated([TARGET]);

    assert.deepStrictEqual(h.finals, [TARGET]);
    assert.strictEqual(h.displayState.date, TARGET);
  });

  it('continues a pending navigation instead of returning to the displayed date', async () => {
    const h = makeHarness({ cached: [A.urls.ultraHighDef] });
    await h.controller.initialize();
    const fetching = gate();
    h.onRequest = async () => {
      await fetching.promise;
      h.cache.add(B.urls.ultraHighDef);
    };

    const navigating = h.controller.navigate(1);
    await settle();
    await h.controller.catalogUpdated([TARGET]);
    const continued = h.controller.catalogUpdated([OLDER]);
    fetching.open();
    await Promise.all([navigating, continued]);

    assert.deepStrictEqual(h.finals, [TARGET, OLDER]);
    assert.strictEqual(h.displayState.date, OLDER);
  });
});

describe('first new tab of a day', () => {
  // Committed at noon in Shanghai on the target date.
  const committedToday = Date.UTC(2026, 9, 13, 4);

  function firstTabOfDay(options) {
    const h = makeHarness({ displayState: snapshotOf(B), ...options });
    h.today = TARGET;
    return h;
  }

  it("shows the committed wallpaper under the updating headline, then today's once it is loaded", async () => {
    const h = firstTabOfDay({ cached: [B.urls.ultraHighDef, B.urls.preview, A.urls.preview] });
    h.onRequest = ({ date, resolution }) => {
      assert.deepStrictEqual(h.finals, [OLDER], "the committed wallpaper stays while today's loads");
      assert.ok(h.updating > 0);
      h.cache.add(h.catalog.entries[date].urls[resolution]);
    };

    const result = await h.controller.initialize();

    assert.strictEqual(result.applied, true);
    assert.deepStrictEqual(h.requests, [{ date: TARGET, resolution: 'ultraHighDef' }]);
    assert.deepStrictEqual(h.finals, [OLDER, TARGET]);
    assert.deepStrictEqual(h.previews, [], "today's preview is not shown");
    assert.strictEqual(h.displayState.date, TARGET);
  });

  it("waits for the catalog to provide today's wallpaper", async () => {
    const h = firstTabOfDay({ entries: [B, C], cached: [B.urls.ultraHighDef, B.urls.preview] });
    h.workerCachesRequests();

    await h.controller.initialize();
    assert.deepStrictEqual(h.finals, [OLDER]);
    assert.strictEqual(h.updating, 1);
    assert.deepStrictEqual(h.requests, []);

    await h.controller.catalogUpdated([OLDER]);
    assert.deepStrictEqual(h.finals, [OLDER], 'a notification for another date changes nothing');

    h.catalog.entries[TARGET] = A;
    await h.controller.catalogUpdated([TARGET]);

    assert.deepStrictEqual(h.finals, [OLDER, TARGET]);
    assert.strictEqual(h.displayState.date, TARGET);
  });

  it('keeps the committed wallpaper and restores its headline when today is not published', async () => {
    const h = firstTabOfDay({ entries: [B, C], cached: [B.urls.ultraHighDef] });
    await h.controller.initialize();
    const published = h.displayState;

    await h.controller.catalogRefreshed();
    h.catalog.entries[TARGET] = A;
    h.workerCachesRequests();
    await h.controller.catalogUpdated([TARGET]);

    assert.deepStrictEqual(h.refreshed, [OLDER], 'the updating headline is withdrawn');
    assert.deepStrictEqual(h.finals, [OLDER], 'the page stopped waiting for today');
    assert.deepStrictEqual(h.displayState, published);
  });

  it('keeps a selection that was committed today', async () => {
    const h = firstTabOfDay({ displayState: snapshotOf(B, { updatedAt: committedToday }), cached: [B.urls.ultraHighDef, A.urls.ultraHighDef] });

    await h.controller.initialize();
    await h.controller.catalogRefreshed();

    assert.deepStrictEqual(h.finals, [OLDER]);
    assert.strictEqual(h.updating, 0);
  });

  it('still moves to today when a notification for the committed date arrives during its restoration', async () => {
    const h = firstTabOfDay({ cached: [B.urls.ultraHighDef, B.urls.preview, A.urls.ultraHighDef, A.urls.preview] });
    const converting = gate();
    h.beforeDataUrl = () => converting.promise;

    const initializing = h.controller.initialize();
    await settle();
    const notified = h.controller.catalogUpdated([OLDER]);
    converting.open();
    await Promise.all([initializing, notified]);

    assert.deepStrictEqual(h.finals, [OLDER, TARGET]);
    assert.strictEqual(h.displayState.date, TARGET);
  });

  it("does not wait for the committed date's missing final image before moving to a cached today", async () => {
    const h = firstTabOfDay({ cached: [B.urls.preview, A.urls.ultraHighDef] });
    const fetching = gate();
    h.onRequest = () => fetching.promise;

    const result = await h.controller.initialize();
    fetching.open();

    assert.strictEqual(result.applied, true);
    assert.deepStrictEqual(h.previews, [OLDER]);
    assert.deepStrictEqual(h.finals, [TARGET]);
    assert.ok(!h.requests.some(request => request.date === OLDER && request.resolution === 'ultraHighDef'),
      "the committed date's final image is not requested");
    assert.strictEqual(h.displayState.date, TARGET);
  });

  it('lets a navigation click win over a notification that arrives while the click reads', async () => {
    const h = firstTabOfDay({ entries: [B, C], cached: [B.urls.ultraHighDef, B.urls.preview, C.urls.ultraHighDef] });
    await h.controller.initialize();
    const reading = gate();
    h.beforeReadCatalog = () => reading.promise;
    const click = h.controller.navigate(1);
    await settle();
    h.beforeReadCatalog = null;

    h.catalog.entries[TARGET] = A;
    h.cache.add(A.urls.ultraHighDef);
    await h.controller.catalogUpdated([TARGET]);
    reading.open();
    await click;

    assert.deepStrictEqual(h.finals, [OLDER, OLDEST]);
    assert.strictEqual(h.displayState.date, OLDEST);
  });

  it('does not make an already-open tab follow the day change when it reinitializes', async () => {
    const h = makeHarness({ displayState: snapshotOf(B), cached: [B.urls.ultraHighDef, B.urls.preview, A.urls.ultraHighDef] });
    h.today = OLDER;
    await h.controller.initialize();

    // Reconnecting after the day boundary reinitializes the open page.
    h.today = TARGET;
    await h.controller.initialize();

    assert.deepStrictEqual(h.finals, [OLDER]);
    assert.strictEqual(h.updating, 0);
    assert.strictEqual(h.displayState.date, OLDER);
  });

  it("restores the committed preview's headline when today is not published", async () => {
    const h = firstTabOfDay({ entries: [B, C], cached: [B.urls.preview] });
    await h.controller.initialize();
    assert.deepStrictEqual(h.previews, [OLDER]);
    assert.ok(h.updating > 0);

    await h.controller.catalogRefreshed();

    assert.deepStrictEqual(h.refreshed, [OLDER]);
  });

  it("lets a navigation click replace the move to today's wallpaper", async () => {
    const h = firstTabOfDay({ entries: [B, C], cached: [B.urls.ultraHighDef, C.urls.ultraHighDef] });
    await h.controller.initialize();

    await h.controller.navigate(1);
    h.catalog.entries[TARGET] = A;
    h.workerCachesRequests();
    await h.controller.catalogUpdated([TARGET]);

    assert.deepStrictEqual(h.finals, [OLDER, OLDEST]);
    assert.strictEqual(h.displayState.date, OLDEST);
  });
});
