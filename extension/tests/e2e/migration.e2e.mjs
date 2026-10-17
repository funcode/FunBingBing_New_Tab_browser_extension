/**
 * Browser checks of the v1-to-v2 migration in the actual MV3 extension. Each
 * test seeds a v1 install and starts a fresh worker, which migrates at start;
 * harness.mjs describes the setup.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert';
import {
  BOOT_PREVIEW, CATALOG_KEY, DISPLAY_STATE_KEY, MIGRATION_KEY, QUOTE_STATE_KEY, backgroundKinds, day, finish,
  migrationPhase, openNewTab, readLocal, readSync, removeLocal, restartWorker, seed, start, writeLocal
} from './harness.mjs';

const v1Image = shown => ({
  isoDate: shown.date,
  headline: shown.headline,
  title: shown.headline,
  imageUrls: { landscape: { highDef: `/th?id=${shown.imageId}_1920x1080.jpg`, ultraHighDef: `/th?id=${shown.imageId}_UHD.jpg` } }
});
const EMPTY_DISPLAY_STATE = { date: '', imageId: '', url: '', preloadDataUrl: '', updatedAt: 0 };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Seed a v1 install, with no v2 catalog or marker, and start a worker that migrates it. */
async function upgradeFrom(local, sync = {}) {
  await seed({ local, sync });
  await removeLocal([CATALOG_KEY, MIGRATION_KEY]);
  await restartWorker();
}

/** The page's settings once its configuration has loaded. */
const pageSettings = (page, keys) => page.evaluate(async (names) => {
  await window.confReadyPromise;
  return Object.fromEntries(names.map(name => [name, readConf(name)]));
}, keys);

describe('v1 to v2 migration in the loaded extension', () => {
  before(start);
  after(finish);

  it('a valid sync setting wins, then a valid local one, then the default; pages and the worker read the same values', async () => {
    await upgradeFrom({
      current_search_engine: 'DuckDuckGo',
      show_clock: 'no',
      show_quote: 'maybe',
      qotd_url: 'http://quotes.example/qotd.json'
    }, { current_search_engine: 'Google', show_clock: 'sometimes' });
    const expected = { current_search_engine: 'Google', show_clock: 'no', show_quote: 'yes', qotd_url: '' };
    const keys = Object.keys(expected);

    assert.strictEqual((await readLocal(MIGRATION_KEY)).phase, 'verified');
    assert.deepStrictEqual(await readSync(keys), expected);
    const local = await readLocal(null);
    for (const key of keys) {
      assert.ok(!(key in local), `${key} remains in local storage`);
    }
    const page = await openNewTab();
    assert.deepStrictEqual(await pageSettings(page, keys), expected);
    await migrationPhase('complete');
    await page.close();
  });

  it('a failed sync write keeps the local settings and leaves migration retryable', async () => {
    // Over chrome.storage.sync's 8 KB quota for one item.
    const oversized = Array.from({ length: 60 }, (_, i) => ({
      name: `Engine ${i}`, icon: 'icons/bing.png', action: `https://search${i}.example/${'x'.repeat(100)}`, param_name: 'q', css_style: ''
    }));
    await upgradeFrom({ search_engine_list: oversized, show_clock: 'no' });

    assert.strictEqual((await readLocal(MIGRATION_KEY)).phase, 'writing');
    const local = await readLocal(null);
    assert.deepStrictEqual([local.search_engine_list, local.show_clock], [oversized, 'no']);
    assert.deepStrictEqual(await readSync(['search_engine_list', 'show_clock']), {});
    // Pages keep applying the local values meanwhile.
    const page = await openNewTab();
    assert.deepStrictEqual(await pageSettings(page, ['show_clock']), { show_clock: 'no' });
    await page.close();

    // Once the write can succeed, the next worker start migrates.
    const trimmed = oversized.slice(0, 3);
    await writeLocal({ search_engine_list: trimmed });
    await restartWorker();

    assert.strictEqual((await readLocal(MIGRATION_KEY)).phase, 'verified');
    assert.deepStrictEqual(await readSync(['search_engine_list', 'show_clock']), { search_engine_list: trimmed, show_clock: 'no' });
    const migrated = await readLocal(null);
    assert.ok(!('search_engine_list' in migrated) && !('show_clock' in migrated), 'local copies are deleted after verification');
  });

  it('the worker verifies without writing display state; the first page writes it, then the v1 state is deleted', async () => {
    const v1Days = Array.from({ length: 9 }, (_, i) => day(-i, `Legacy${i}`, '#556677'));
    // The v1 page last showed an image that is no longer in bing_images.
    const gone = day(-20, 'Gone', '#000000');
    const legacyKeys = ['bing_images', 'wallpaper_date', 'wallpaper_idx', 'wallpaper_url', 'wallpaper_preload_data_url', 'cache_quote_state'];
    await upgradeFrom({
      bing_images: v1Days.map(v1Image),
      wallpaper_date: v1Days[0].date,
      wallpaper_idx: '0',
      wallpaper_url: gone.urls.highDef.replace('ts1.tc.mm.bing.net', 'cn.bing.com'),
      wallpaper_preload_data_url: BOOT_PREVIEW,
      cache_quote_state: { quotes: { [v1Days[1].date]: { text: 'v1 quote', source: 'v1 author', caption: 'v1 caption', link: '' } } }
    });
    await pause(500);

    const verified = await readLocal(null);
    assert.strictEqual(verified[MIGRATION_KEY].phase, 'verified', 'migration waits for a page');
    assert.ok(!(DISPLAY_STATE_KEY in verified), 'the worker writes no display state');
    assert.deepStrictEqual(Object.keys(verified[CATALOG_KEY].entries).sort(), v1Days.slice(0, 8).map(shown => shown.date).sort(),
      'the newest eight v1 dates');
    assert.strictEqual(verified[QUOTE_STATE_KEY].quotes[v1Days[1].date].text, 'v1 quote');
    for (const key of legacyKeys) {
      assert.ok(key in verified, `${key} is deleted before the page handed off`);
    }

    const page = await openNewTab();
    await migrationPhase('complete');

    const complete = await readLocal(null);
    assert.deepStrictEqual(complete[DISPLAY_STATE_KEY], EMPTY_DISPLAY_STATE, 'the explicit empty display state; the v1 preview is not copied');
    for (const key of legacyKeys) {
      assert.ok(!(key in complete), `${key} remains`);
    }
    assert.ok(!(await backgroundKinds(page)).includes('data'), 'the v1 preview is never painted');
    assert.deepStrictEqual(page.errors, []);
    await page.close();
  });
});
