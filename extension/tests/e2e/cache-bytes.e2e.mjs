/**
 * Measurement of the steady-state Cache Storage bytes of the regular
 * retention set at its 32-key maximum, HD and UHD, with real Bing responses.
 * Opt-in, because it needs the network:
 * `ATARAXIA_MEASURE_CACHE_BYTES=1 npm run test:e2e`.
 *
 * Observability only: no byte threshold is asserted (ADR-0002). The report
 * goes to the test diagnostics and to output/cache-bytes.json; a run in which
 * any retained response is missing is reported as incomplete.
 */

import { after, before, describe, it } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { addDays, isValidCalendarDate } from '../../src/helpers/date.js';
import { buildCanonicalUrls, extractImageId } from '../../src/helpers/image.js';
import { calculateRetentionSet } from '../../src/helpers/retention.js';
import {
  CATALOG_KEY, DISPLAY_STATE_KEY, EXTENSION, cachedBytes, fetchIntoCache, fetchJson, finish, readLocal, sendMessage,
  start, stopWorker, writeLocal, writeSync
} from './harness.mjs';

const ENABLED = process.env.ATARAXIA_MEASURE_CACHE_BYTES === '1';
const ARCHIVE = 'https://www.bing.com/HPImageArchive.aspx?format=js&idx=7&n=8&mkt=zh-CN';
const QUIET_MS = 20 * 1000;
const LIMIT_MS = 10 * 60 * 1000;

const kindOf = url => (url.endsWith('_640x360.jpg') ? 'preview' : 'final');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function targetDateOfCatalog() {
  for (const startedAt = Date.now(); Date.now() - startedAt < LIMIT_MS; await pause(1000)) {
    const date = (await readLocal(CATALOG_KEY))?.refreshState?.date;
    if (isValidCalendarDate(date)) return date;
  }
  throw new Error('The catalog has no target date');
}

/**
 * A page still shows a wallpaper that has left the base window, so its
 * preview and final response are the two display-protection keys beyond the
 * 30 base keys. The image is an Archive one older than the window. Its
 * responses are cached the way the worker did while it was in the window,
 * and the snapshot is the one that page committed.
 *
 * The worker is stopped meanwhile: a cleanup that read the earlier retention
 * set would delete the responses as unreferenced, and nothing fetches them
 * again. A refresh then resumes the worker's work.
 */
async function showOlderImage(targetDate, resolution) {
  const older = (await fetchJson(ARCHIVE)).images
    .filter(image => image.enddate < addDays(targetDate, -7))
    .sort((a, b) => (a.enddate < b.enddate ? -1 : 1))[0];
  const imageId = extractImageId(older.urlbase);
  const urls = buildCanonicalUrls(imageId);
  await stopWorker();
  await writeLocal({
    [DISPLAY_STATE_KEY]: { date: older.enddate, imageId, url: urls[resolution], preloadDataUrl: '', updatedAt: Date.now() }
  });
  await fetchIntoCache([urls.preview, urls[resolution]]);
  await sendMessage({ type: 'refreshWallpaperCatalog' });
}

/**
 * Wait until every retained key of the resolution is cached or recorded as
 * failed, nothing else is cached, and Cache Storage has not changed for
 * QUIET_MS.
 */
async function steadyState(enableUhd) {
  const startedAt = Date.now();
  let last = '';
  let quietSince = Date.now();
  for (;;) {
    const [catalog, displayState] = [await readLocal(CATALOG_KEY), await readLocal(DISPLAY_STATE_KEY)];
    const cached = await cachedBytes();
    const urls = new Set(cached.map(item => item.url));
    const signature = JSON.stringify([...urls].sort());
    if (signature !== last) {
      last = signature;
      quietSince = Date.now();
    }
    const retained = [...calculateRetentionSet(catalog, displayState, enableUhd, catalog.refreshState.date)];
    const settled = retained.every(url => urls.has(url) || url in catalog.refreshState.imageFailures) &&
      [...urls].every(url => retained.includes(url));
    if (settled && Date.now() - quietSince >= QUIET_MS) {
      return { catalog, cached, retained };
    }
    if (Date.now() - startedAt > LIMIT_MS) {
      throw new Error('Cache Storage did not reach a steady state');
    }
    await pause(2000);
  }
}

function summarize({ catalog, cached, retained }) {
  const stats = (items) => {
    const bytes = items.reduce((sum, item) => sum + item.bytes, 0);
    return { keys: items.length, bytes, averageBytes: items.length > 0 ? Math.round(bytes / items.length) : 0 };
  };
  const missingKeys = retained.filter(url => !cached.some(item => item.url === url));
  return {
    targetDate: catalog.refreshState.date,
    complete: missingKeys.length === 0,
    missingKeys,
    retainedKeys: retained.length,
    cachedKeys: cached.length,
    totalBytes: stats(cached).bytes,
    previews: stats(cached.filter(item => kindOf(item.url) === 'preview')),
    finals: stats(cached.filter(item => kindOf(item.url) === 'final'))
  };
}

describe('retained wallpaper image bytes', { skip: !ENABLED && 'set ATARAXIA_MEASURE_CACHE_BYTES=1 to measure with the real network' }, () => {
  before(() => start({ network: true }));
  after(finish);

  it('records HD and UHD steady-state bytes of the 32-key regular retention set', { timeout: 2 * LIMIT_MS + 120 * 1000 }, async (t) => {
    // A new install fetches the catalog and its images; UHD is the default.
    const targetDate = await targetDateOfCatalog();
    await showOlderImage(targetDate, 'ultraHighDef');
    const uhd = summarize(await steadyState(true));
    await showOlderImage(targetDate, 'highDef');
    await writeSync({ enable_uhd_wallpaper: 'no' });
    const hd = summarize(await steadyState(false));

    const report = { measuredAt: new Date().toISOString(), hd, uhd };
    const file = path.join(EXTENSION, 'output', 'cache-bytes.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
    t.diagnostic(`cache bytes: ${JSON.stringify(report)}`);
    for (const [resolution, summary] of Object.entries({ hd, uhd })) {
      if (!summary.complete) t.diagnostic(`${resolution} measurement is incomplete: ${summary.missingKeys.length} retained keys are missing`);
    }
  });
});
