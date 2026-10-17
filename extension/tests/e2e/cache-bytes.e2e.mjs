/**
 * Measurement of the steady-state Cache Storage bytes of the regular
 * retention set, HD and UHD, with real Bing responses. Opt-in, because it
 * needs the network: `ATARAXIA_MEASURE_CACHE_BYTES=1 npm run test:e2e`.
 *
 * Observability only: no byte threshold is asserted (ADR-0002). The report
 * goes to the test diagnostics and to output/cache-bytes.json.
 */

import { after, before, describe, it } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { calculateRetentionSet } from '../../src/helpers/retention.js';
import {
  CATALOG_KEY, EXTENSION, cachedBytes, finish, readLocal, start, writeSync
} from './harness.mjs';

const ENABLED = process.env.ATARAXIA_MEASURE_CACHE_BYTES === '1';
// Base keys are 15 dates at preview and final resolution; display protection
// adds at most one preview and one final.
const MAX_KEYS = 32;
const QUIET_MS = 20 * 1000;
const LIMIT_MS = 10 * 60 * 1000;

const kindOf = url => (url.endsWith('_640x360.jpg') ? 'preview' : url.endsWith('_UHD.jpg') ? 'ultraHighDef' : 'highDef');

/**
 * Wait until every base key of the resolution is cached or recorded as
 * failed, and Cache Storage has not changed for QUIET_MS.
 */
async function steadyState(enableUhd) {
  const startedAt = Date.now();
  let last = '';
  let quietSince = Date.now();
  for (;;) {
    const catalog = await readLocal(CATALOG_KEY);
    const cached = await cachedBytes();
    const urls = new Set(cached.map(item => item.url));
    const signature = JSON.stringify([...urls].sort());
    if (signature !== last) {
      last = signature;
      quietSince = Date.now();
    }
    const retained = [...calculateRetentionSet(catalog, null, enableUhd, catalog?.refreshState?.date)];
    const settled = retained.length > 0 && retained.every(url => urls.has(url) || url in catalog.refreshState.imageFailures) &&
      [...urls].every(url => retained.includes(url));
    if (settled && Date.now() - quietSince >= QUIET_MS) {
      return { catalog, cached, retained };
    }
    if (Date.now() - startedAt > LIMIT_MS) {
      throw new Error('Cache Storage did not reach a steady state');
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}

function summarize({ catalog, cached, retained }, finalKind) {
  const byKind = kind => cached.filter(item => kindOf(item.url) === kind).map(item => item.bytes);
  const stats = (sizes) => {
    const total = sizes.reduce((sum, bytes) => sum + bytes, 0);
    return { keys: sizes.length, bytes: total, averageBytes: sizes.length > 0 ? Math.round(total / sizes.length) : 0 };
  };
  const previews = stats(byKind('preview'));
  const finals = stats(byKind(finalKind));
  return {
    targetDate: catalog.refreshState.date,
    retainedKeys: retained.length,
    cachedKeys: cached.length,
    failedKeys: retained.filter(url => url in catalog.refreshState.imageFailures).length,
    totalBytes: previews.bytes + finals.bytes,
    previews,
    finals,
    // The measured averages scaled to the regular maximum of 32 keys.
    projectedBytesAt32Keys: (previews.averageBytes + finals.averageBytes) * (MAX_KEYS / 2)
  };
}

describe('retained wallpaper image bytes', { skip: !ENABLED && 'set ATARAXIA_MEASURE_CACHE_BYTES=1 to measure with the real network' }, () => {
  before(() => start({ network: true }));
  after(finish);

  it('records HD and UHD steady-state bytes of the regular retention set', { timeout: 2 * LIMIT_MS + 60 * 1000 }, async (t) => {
    // A new install fetches the catalog and its images; UHD is the default.
    const uhd = summarize(await steadyState(true), 'ultraHighDef');
    await writeSync({ enable_uhd_wallpaper: 'no' });
    const hd = summarize(await steadyState(false), 'highDef');

    const report = { measuredAt: new Date().toISOString(), maxKeys: MAX_KEYS, hd, uhd };
    const file = path.join(EXTENSION, 'output', 'cache-bytes.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
    t.diagnostic(`cache bytes: ${JSON.stringify(report)}`);
  });
});
