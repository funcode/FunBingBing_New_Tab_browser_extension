/**
 * Interleavings of two page actions in the wallpaper controller.
 *
 * Each scenario runs a first action, holds it at one awaited dependency call,
 * starts a second action and lets it run as far as it can, then releases the
 * first. Every awaited
 * call the first action makes is held in turn. After both settle, the page
 * must still satisfy the stale-work invariants below.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createWallpaperController } from '../src/page/wallpaper-controller.js';

const TARGET = '20261013';
const OLDER = '20261012';
const OLDEST = '20261011';

function entry(date, name) {
  const imageId = `OHR.${name}_ZH-CN1000000000`;
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

const A = entry(TARGET, 'Target');
const B = entry(OLDER, 'Older');
const C = entry(OLDEST, 'Oldest');

// Committed at the given time; 42 is a market day long before TARGET.
const snapshotOf = (shown, updatedAt = Date.UTC(2026, 9, 13, 4)) => ({
  date: shown.date, imageId: shown.imageId, url: shown.urls.ultraHighDef, preloadDataUrl: '', updatedAt
});
const YESTERDAY = 42;

const DEPENDENCIES = ['readCatalog', 'readUhdSetting', 'readDisplayState', 'matchImage', 'toDataUrl', 'requestImage', 'applyFinal', 'writeDisplayState'];
const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve));
};

/**
 * One page against an in-memory catalog, display state and Cache Storage.
 * Every injected dependency goes through `step`, which can hold one call.
 * The worker completes each image request by caching the image.
 */
function makePage({ entries = [A, B, C], displayState = null, cached, today = '19700101' }) {
  const page = {
    catalog: { version: 2, refreshState: { date: TARGET }, entries: Object.fromEntries(entries.map(e => [e.date, e])) },
    displayState,
    cache: new Set(cached ?? [A, B, C].flatMap(e => [e.urls.ultraHighDef]).concat(A.urls.preview, B.urls.preview)),
    enableUhd: 'yes',
    finals: [],
    counts: {},
    hold: null
  };

  async function step(name) {
    const n = page.counts[name] = (page.counts[name] ?? 0) + 1;
    if (page.hold && page.hold.name === name && page.hold.n === n) {
      const { gate, reached } = page.hold;
      page.hold = null;
      reached();
      await gate;
    }
  }

  page.controller = createWallpaperController({
    readCatalog: async () => { await step('readCatalog'); return page.catalog; },
    readDisplayState: async () => { await step('readDisplayState'); return page.displayState; },
    writeDisplayState: async (snapshot) => { await step('writeDisplayState'); page.displayState = snapshot; },
    matchImage: async (url) => { await step('matchImage'); return page.cache.has(url) ? url : null; },
    toDataUrl: async (blob) => { await step('toDataUrl'); return `data:image/jpeg;base64,${blob.length}`; },
    requestImage: async ({ date, resolution }) => {
      await step('requestImage');
      const url = page.catalog.entries[date]?.urls[resolution];
      if (url) page.cache.add(url);
    },
    // A held read returns the setting as it was when the read was issued.
    readUhdSetting: async () => {
      const setting = page.enableUhd;
      await step('readUhdSetting');
      return setting;
    },
    now: () => 1000,
    getTargetDate: () => today,
    view: {
      applyFinal: async ({ view, isCurrent }) => {
        await step('applyFinal');
        if (!isCurrent()) return false;
        page.finals.push({ date: view.date, imageId: view.imageId, url: view.url });
        return true;
      },
      applyPreview() {},
      refreshContents() {},
      showUpdating() {},
      showFallback() {}
    },
    log: { warn() {} }
  });

  /** Hold the n-th call to `name` counted from now; resolves when it is reached. */
  page.armHold = (name, n) => {
    page.counts = {};
    let reached;
    let open;
    const reachedPromise = new Promise(resolve => { reached = resolve; });
    const gate = new Promise(resolve => { open = resolve; });
    page.hold = { name, n, gate, reached };
    return { reachedPromise, release: open };
  };
  return page;
}

/**
 * Invariants checked after every interleaving:
 * - the snapshot matches the screen: the stored snapshot is the last final
 *   image the page applied;
 * - a newer action wins: when the second action applied or kept an image,
 *   no final image is applied after it finished;
 * - the page ends on an image: a page that initializes ends showing a final
 *   image (all finals are cached), or the scenario's expected one.
 */
function checkInvariants(page, { second, finalsAfterSecond, scenario, where }) {
  const last = page.finals.at(-1);
  if (last) {
    const { date, imageId, url } = page.displayState ?? {};
    assert.deepStrictEqual({ date, imageId, url }, last, `${where}: the snapshot is not the image on screen`);
  }
  if (second.applied) {
    assert.strictEqual(page.finals.length, finalsAfterSecond, `${where}: an older action applied an image after a newer one`);
  }
  if (scenario.endsOn) {
    assert.strictEqual(last?.date, scenario.endsOn, `${where}: the page does not end on ${scenario.endsOn}`);
  } else if (scenario.fresh) {
    assert.ok(last, `${where}: the page ends without a final image`);
  }
}

async function runScenario(scenario) {
  const prepare = async () => {
    const page = makePage(scenario.page());
    if (!scenario.fresh) {
      await page.controller.initialize();
      await settle();
    }
    await scenario.before?.(page);
    return page;
  };

  // Count the calls the first action makes on its own.
  const solo = await prepare();
  solo.counts = {};
  await scenario.first(solo.controller);
  await settle();
  const counts = { ...solo.counts };

  let runs = 0;
  for (const name of DEPENDENCIES) {
    for (let n = 1; n <= (counts[name] ?? 0); n++) {
      const page = await prepare();
      const { reachedPromise, release } = page.armHold(name, n);
      const first = scenario.first(page.controller);
      const reached = await Promise.race([reachedPromise.then(() => true), first.then(() => false)]);
      if (!reached) continue;
      await scenario.beforeSecond?.(page);
      // The second action may itself wait behind the held call (snapshot
      // writes are serialized), so it is released before the second finishes.
      let finalsAfterSecond;
      const secondDone = scenario.second(page.controller).then((result) => {
        finalsAfterSecond = page.finals.length;
        return result;
      });
      await settle();
      release();
      const [second] = await Promise.all([secondDone, first]);
      await settle();
      checkInvariants(page, { second, finalsAfterSecond, scenario, where: `${name} call ${n}` });
      runs++;
    }
  }
  assert.ok(runs > 0, 'no interleaving was exercised');
}

const committedA = () => ({ displayState: snapshotOf(A) });

const SCENARIOS = [
  { name: 'previous click, then next click', page: committedA, first: c => c.navigate(1), second: c => c.navigate(-1) },
  { name: 'previous click, then another previous click', page: committedA, first: c => c.navigate(1), second: c => c.navigate(1) },
  { name: 'click, then reinitialization', page: committedA, first: c => c.navigate(1), second: c => c.initialize() },
  { name: 'click, then a notification for the displayed date', page: committedA, first: c => c.navigate(1), second: c => c.catalogUpdated([TARGET]) },
  { name: 'click, then a notification for another date', page: committedA, first: c => c.navigate(1), second: c => c.catalogUpdated([OLDEST]) },
  { name: 'notification, then a click', page: committedA, first: c => c.catalogUpdated([TARGET]), second: c => c.navigate(1) },
  { name: 'startup, then a click', fresh: true, page: committedA, first: c => c.initialize(), second: c => c.navigate(1) },
  { name: 'startup, then a notification', fresh: true, page: committedA, first: c => c.initialize(), second: c => c.catalogUpdated([TARGET]) },
  {
    name: 'startup of a page with an empty catalog, then a click with nowhere to go',
    fresh: true,
    page: () => ({ entries: [], displayState: snapshotOf(B) }),
    first: c => c.initialize(),
    second: c => c.navigate(1),
    endsOn: OLDER
  },
  {
    name: 'first tab of the day, then a notification for the committed date',
    fresh: true,
    page: () => ({ displayState: snapshotOf(B, YESTERDAY), today: TARGET }),
    first: c => c.initialize(),
    second: c => c.catalogUpdated([OLDER]),
    endsOn: TARGET
  },
  {
    name: 'click, then a resolution change',
    page: committedA,
    first: c => c.navigate(1),
    beforeSecond: (page) => { page.enableUhd = 'no'; },
    second: c => c.resolutionChanged()
  },
  {
    name: 'resolution change, then a click',
    page: committedA,
    before: (page) => { page.enableUhd = 'no'; },
    first: c => c.resolutionChanged(),
    second: c => c.navigate(1),
    endsOn: OLDER
  },
  {
    name: "refresh finished without today, then today's notification",
    page: () => ({ entries: [B, C], displayState: snapshotOf(B, YESTERDAY), today: TARGET }),
    first: c => c.catalogRefreshed(),
    beforeSecond: (page) => {
      page.catalog.entries[TARGET] = A;
      page.cache.add(A.urls.ultraHighDef);
    },
    second: c => c.catalogUpdated([TARGET]),
    endsOn: TARGET
  },
  {
    name: "click while waiting for today, then today's notification",
    page: () => ({ entries: [B, C], displayState: snapshotOf(B, YESTERDAY), today: TARGET }),
    first: c => c.navigate(1),
    beforeSecond: (page) => {
      page.catalog.entries[TARGET] = A;
      page.cache.add(A.urls.ultraHighDef);
    },
    second: c => c.catalogUpdated([TARGET]),
    endsOn: OLDEST
  }
];

describe('wallpaper controller interleavings', () => {
  for (const scenario of SCENARIOS) {
    it(scenario.name, () => runScenario(scenario));
  }
});
