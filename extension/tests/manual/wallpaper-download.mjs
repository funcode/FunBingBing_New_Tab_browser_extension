import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as h from '../e2e/harness.mjs';

const reportFile = path.join(h.EXTENSION, 'output', 'native-acceptance', 'wallpaper-download.json');
const timeout = Number(process.env.NATIVE_ACCEPTANCE_TIMEOUT_MS ?? 180_000);
const terminalStates = ['denied', 'complete', 'cancelled', 'failed', 'unconfirmed'];
const report = { manifest: 'production', result: 'running', stages: [] };

fs.mkdirSync(path.dirname(reportFile), { recursive: true });
function writeReport() {
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');
}

function begin(stage, instruction) {
  report.stages.push({ stage, startedAt: new Date().toISOString() });
  writeReport();
  if (instruction) console.log(instruction);
}

function record(observation) {
  Object.assign(report.stages.at(-1), { observedAt: new Date().toISOString(), ...observation });
  writeReport();
}

async function observe(page) {
  const observation = page.evaluate(async () => ({
    state: document.getElementById('wallpaper-actions').dataset.saveState,
    feedback: document.getElementById('wallpaper-actions-status').textContent,
    granted: await chrome.permissions.contains({ permissions: ['downloads'] }),
    downloadApiAvailable: Boolean(chrome.downloads),
    completions: window.__nativeSaves,
    downloads: (await chrome.downloads?.search({}) ?? []).map(({ id, filename, state, error }) => (
      { id, filename, state, error }
    ))
  }));
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Timed out reading Chromium download state.')), 5000);
  });
  try {
    return await Promise.race([observation, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

async function waitForState(page, states = terminalStates) {
  await page.waitForFunction(states => states.includes(document.getElementById('wallpaper-actions').dataset.saveState),
    states, { polling: 100, timeout });
  const observation = await observe(page);
  record(observation);
  return observation;
}

begin('startup');
let page;
try {
  assert.ok(Number.isSafeInteger(timeout) && timeout > 0 && timeout <= 2_147_483_647,
    'NATIVE_ACCEPTANCE_TIMEOUT_MS must be a positive timeout in milliseconds');
  await h.start({ nativeDownloads: true });
  const image = h.day(0, 'NativeSaveAcceptance', '#207050');
  const final = h.final(image);
  await h.seed({ days: [image], cached: [final, h.preview(image)] });
  const expectedBytes = await h.jpeg(final.color, final.size);
  const targetFile = path.join(path.dirname(h.downloadDirectory), 'save-as', 'wallpaper.jpg');
  fs.mkdirSync(path.dirname(targetFile));

  page = await h.context.newPage();
  page.setDefaultTimeout(15_000);
  await page.addInitScript(() => {
    const fetch = window.fetch.bind(window);
    window.fetch = (resource, options) => resource === 'https://www.bing.com/favicon.ico' && options?.method === 'HEAD'
      ? Promise.resolve(new Response('', { status: 200 }))
      : fetch(resource, options);
    window.__nativeSaves = [];
    window.addEventListener('funbingbing:wallpapersaved', ({ detail }) => {
      const { downloadId, filename, capture: { date, imageId, resolution } } = detail;
      window.__nativeSaves.push({ downloadId, filename, capture: { date, imageId, resolution } });
    });
  });
  await page.goto('chrome://newtab/');
  await page.evaluate(() => { document.title = 'Ataraxia native download acceptance'; });
  await page.bringToFront();
  await page.locator('#download-image-btn:enabled').waitFor();
  const initial = await observe(page);
  record({ ...initial, targetFile, timeoutMs: timeout });
  assert.equal(initial.granted, false);
  assert.equal(initial.downloadApiAvailable, false);

  const download = page.locator('#download-image-btn');
  const proceed = page.locator('#wallpaper-download-permission-continue');
  begin('deny-permission', 'When Chromium asks for download access, choose Deny.');
  await download.click();
  await proceed.click();
  const denied = await waitForState(page, ['saving', ...terminalStates]);
  assert.equal(denied.state, 'denied');
  assert.equal(denied.granted, false);
  assert.equal(denied.downloadApiAvailable, false);
  assert.equal(denied.completions.length, 0);
  assert.equal(denied.feedback, await page.evaluate(() => chrome.i18n.getMessage('wallpaper_permission_declined')));

  begin('grant-and-save-as', `On retry, choose Accept or Allow in Chromium.
In Save As, enter this full path in the file name field and choose Save:
${targetFile}`);
  await download.click();
  await proceed.click();
  const saved = await waitForState(page);
  assert.equal(saved.state, 'complete');
  assert.equal(saved.granted, true);
  assert.equal(saved.downloadApiAvailable, true);
  assert.equal(saved.completions.length, 1);
  const [completed] = saved.completions;
  assert.deepEqual(completed.capture, { date: image.date, imageId: image.imageId, resolution: 'ultraHighDef' });
  const [item] = saved.downloads;
  assert.equal(saved.downloads.length, 1);
  assert.equal(item.id, completed.downloadId);
  assert.equal(item.state, 'complete');
  assert.equal(item.filename, completed.filename);
  assert.equal(path.relative(targetFile, completed.filename), '', 'use the specified alternate Save As path');
  const bytes = fs.readFileSync(completed.filename);
  record({ byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
    fileBytesMatchedFixture: bytes.equals(expectedBytes) });
  assert.deepEqual(bytes, expectedBytes);

  begin('cancel-save-as', 'When the next Save As dialog opens, choose Cancel.');
  await download.click();
  const cancelled = await waitForState(page);
  assert.equal(cancelled.state, 'cancelled');
  assert.deepEqual(cancelled.completions, saved.completions);
  const newDownloads = cancelled.downloads.filter(download => download.id !== completed.downloadId);
  assert.equal(newDownloads.length, 1);
  assert.equal(newDownloads[0].state, 'interrupted');
  assert.equal(newDownloads[0].error, 'USER_CANCELED');
} catch (error) {
  report.error = { stage: report.stages.at(-1).stage, message: error.stack };
  console.error(error);
  process.exitCode = 1;
  if (page && !page.isClosed()) {
    const lastObserved = await observe(page).catch(error => ({ error: error.message }));
    record({ lastObserved });
  }
} finally {
  try {
    await h.finish();
    report.profileRemoved = true;
  } catch (error) {
    report.cleanupError = error.stack;
    console.error(error);
    process.exitCode = 1;
  }
  report.result = process.exitCode ? 'failed' : 'passed';
  report.finishedAt = new Date().toISOString();
  writeReport();
  console.log(`Native download acceptance ${report.result}. Report at ${reportFile}`);
}
