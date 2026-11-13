import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { DESKTOP_WALLPAPER_AVAILABLE as hint } from '../../src/helpers/desktop-wallpaper-availability.js';
import * as h from './harness.mjs';

const first = h.day(0, 'DesktopTarget', '#a03020');
const older = h.day(-1, 'DesktopOlder', '#2060a0');
const firstHd = { ...first, color: '#e09020' };
const compatible = { type: 'compatibility', protocolVersion: 1, compatible: true, canApplyWallpaper: true };
const downloadButton = page => page.locator('#download-image-btn');
const desktopButton = page => page.locator('#desktop-wallpaper-btn');
const downloadSwitch = page => page.locator('#enable-image-download-checkbox');
const desktopSwitch = page => page.locator('#enable-desktop-wallpaper-checkbox');
const folder = page => page.locator('#wallpaper-download-folder');
const setupState = (page, value) => page.locator(`#desktop-wallpaper-setup-status[data-state="${value}"]`).waitFor();
const actionState = (page, kind, value) => page.locator(`#wallpaper-actions[data-${kind}-state="${value}"]`).waitFor({
  state: 'attached'
});
const downloadRecord = (page, id) => page.evaluate(async id => (await chrome.downloads.search({ id }))[0], id);

async function controlHost(worker) {
  await worker.evaluate(compatibility => {
    globalThis.wallpaperHostCalls = [];
    chrome.runtime.connectNative = name => {
      const messages = new Set();
      const disconnects = new Set();
      const call = {
        name,
        disconnected: false,
        receive(message) { for (const listener of messages) listener(message); }
      };
      globalThis.wallpaperHostCalls.push(call);
      return {
        onMessage: { addListener: listener => messages.add(listener), removeListener: listener => messages.delete(listener) },
        onDisconnect: { addListener: listener => disconnects.add(listener), removeListener: listener => disconnects.delete(listener) },
        postMessage(request) {
          call.request = request;
          if (request.type === 'verify') queueMicrotask(() => call.receive(compatibility));
        },
        disconnect() { call.disconnected = true; }
      };
    };
  }, compatible);
}

function hostCalls(worker) {
  return worker.evaluate(() => globalThis.wallpaperHostCalls.map(({ name, request, disconnected }) => ({
    name, request, disconnected
  })));
}

async function expectApplication(worker, index, file) {
  await h.eventually(async () => Boolean((await hostCalls(worker))[index]?.request), 'helper application did not start');
  const calls = await hostCalls(worker);
  assert.equal(calls.length, index + 1);
  assert.deepEqual(calls[index], {
    name: 'com.idealland.ataraxia_wallpaper',
    request: { type: 'apply', protocolVersion: 1, path: file },
    disconnected: false
  });
}

function reply(worker, index, ...messages) {
  return worker.evaluate(({ index, messages }) => {
    for (const message of messages) globalThis.wallpaperHostCalls[index].receive(message);
  }, { index, messages });
}

function terminal(status) {
  return { type: 'result', status };
}

async function fixture(t, sync = {}) {
  await h.start({ downloads: true, nativeMessaging: true });
  t.after(h.finish);
  await h.seed({
    days: [first, older],
    cached: [h.final(first), h.finalHd(firstHd), h.final(older), h.finalHd(older)],
    sync: { enable_uhd_wallpaper: 'yes', ...sync }
  });
  const worker = await h.worker();
  await controlHost(worker);
  const options = await h.openOptions();
  await options.locator('#nav-wallpaper').click();
  await h.eventually(() => desktopSwitch(options).isEnabled());
  const page = await h.context.newPage();
  await page.addInitScript(() => {
    const fetch = window.fetch.bind(window);
    window.fetch = (resource, options) => resource === 'https://www.bing.com/favicon.ico'
      ? Promise.resolve(new Response('', { status: 200 })) : fetch(resource, options);
  });
  await page.goto('chrome://newtab/');
  await h.showsFinal(page);
  return { worker, options, page };
}

async function enableDesktop(options, page) {
  await desktopSwitch(options).click();
  await setupState(options, 'verified');
  await h.eventually(async () => await desktopButton(page).isVisible() && await desktopButton(page).isEnabled());
}

async function confirmDesktopAction(page) {
  await desktopButton(page).click();
  await page.locator('#wallpaper-desktop-confirmation-confirm').click();
}

async function keyboardTargets(page, expected) {
  await page.bringToFront();
  await page.locator('#widgets-toggle').focus();
  for (const id of expected) {
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.id), id);
  }
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => Boolean(document.activeElement?.closest('#wallpaper-actions'))), false);
}

async function holdBrowserSave(page) {
  await page.evaluate(() => {
    globalThis.heldWallpaperDownloads = new Map();
    chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
      globalThis.heldWallpaperDownloads.set(item.id, suggest);
      return true;
    });
  });
}

async function pendingDownload(page) {
  await page.waitForFunction(() => globalThis.heldWallpaperDownloads.size === 1);
  const id = await page.evaluate(() => [...globalThis.heldWallpaperDownloads.keys()][0]);
  const item = await downloadRecord(page, id);
  assert.equal(item.state, 'in_progress');
  assert.ok(item.bytesReceived > 0);
  return id;
}

async function completeDownload(page, id, expected) {
  let item;
  await h.eventually(async () => {
    item = await downloadRecord(page, id);
    return item?.state === 'complete';
  }, 'browser did not complete the wallpaper download');
  assert.ok(path.isAbsolute(item.filename));
  assert.deepEqual(fs.readFileSync(item.filename), await h.jpeg(expected.color, 64));
  return item;
}

async function newDownload(page, previousId) {
  let item;
  await h.eventually(async () => {
    const items = await page.evaluate(() => chrome.downloads.search({ orderBy: ['-startTime'], limit: 2 }));
    item = items.find(record => record.id !== previousId);
    return Boolean(item);
  });
  return item.id;
}

test('desktop wallpaper requires explicit confirmation before saving or applying', async t => {
  const { worker, options, page } = await fixture(t);
  await enableDesktop(options, page);
  await page.bringToFront();
  await page.setViewportSize({ width: 480, height: 400 });
  const dialog = page.locator('#wallpaper-desktop-confirmation-dialog');
  const cancel = dialog.getByRole('button', { name: await page.evaluate(() => chrome.i18n.getMessage('wallpaper_permission_cancel')) });
  const assertNoOperation = async () => {
    assert.deepEqual(await page.evaluate(() => chrome.downloads.search({})), []);
    assert.equal((await hostCalls(worker)).length, 1, 'only Setup verification should have reached the helper');
  };

  await desktopButton(page).dblclick();
  await dialog.waitFor();
  await assertNoOperation();
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });

  await desktopButton(page).click();
  await dialog.waitFor();
  assert.equal(await cancel.evaluate(button => document.activeElement === button), true);
  await assertNoOperation();
  await page.keyboard.press('Enter');
  await dialog.waitFor({ state: 'hidden' });
  await assertNoOperation();

  await desktopButton(page).click();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Enter');
  await dialog.waitFor({ state: 'hidden' });
  const item = await completeDownload(page, await newDownload(page), first);
  await expectApplication(worker, 1, item.filename);
  await reply(worker, 1, compatible, { type: 'accepted' }, terminal('applied'));
  await actionState(page, 'desktop', 'applied');
});

for (const activation of ['hover', 'keyboard focus']) {
  test(`desktop success feedback clears on ${activation}`, async t => {
    const { worker, options, page } = await fixture(t, { enable_image_download: 'no' });
    await enableDesktop(options, page);
    await page.bringToFront();
    await confirmDesktopAction(page);
    const item = await completeDownload(page, await newDownload(page), first);
    await expectApplication(worker, 1, item.filename);

    const status = page.locator('#wallpaper-actions-status');
    const success = await page.evaluate(() => chrome.i18n.getMessage('wallpaper_desktop_applied'));
    await page.mouse.move(0, 0);
    await page.locator('#widgets-toggle').focus();
    await reply(worker, 1, compatible, { type: 'accepted' }, terminal('applied'));
    await actionState(page, 'desktop', 'applied');
    assert.equal(await status.textContent(), success);

    if (activation === 'hover') {
      await page.locator('#wallpaper-actions').hover();
    } else {
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'desktop-wallpaper-btn');
    }
    assert.equal(await status.textContent(), '');
  });
}

test('real Setup toggles both action slots and desktop-only saves the selected HD image', async t => {
  const { worker, options, page } = await fixture(t, { enable_uhd_wallpaper: 'no', wallpaper_download_folder: 'Retained' });
  await h.eventually(() => downloadButton(page).isEnabled());
  const originalPosition = await downloadButton(page).boundingBox();
  assert.ok(originalPosition);
  assert.equal(await desktopButton(page).isVisible(), false);
  assert.equal(await folder(options).isEnabled(), true);
  await keyboardTargets(page, ['download-image-btn']);
  assert.deepEqual(await hostCalls(worker), []);

  await enableDesktop(options, page);
  assert.deepEqual(await downloadButton(page).boundingBox(), originalPosition);
  assert.equal(await folder(options).isEnabled(), true);
  await keyboardTargets(page, ['download-image-btn', 'desktop-wallpaper-btn']);
  assert.deepEqual(await hostCalls(worker), [{
    name: 'com.idealland.ataraxia_wallpaper',
    request: { type: 'verify', protocolVersion: 1 },
    disconnected: true
  }]);

  await downloadSwitch(options).uncheck();
  await downloadButton(page).waitFor({ state: 'hidden' });
  assert.equal(await folder(options).isEnabled(), true);
  await keyboardTargets(page, ['desktop-wallpaper-btn']);
  await confirmDesktopAction(page);
  const item = await completeDownload(page, await newDownload(page), firstHd);
  assert.equal(path.dirname(item.filename), path.join(h.downloadDirectory, 'Retained'));
  assert.match(path.basename(item.filename), /-HD\.jpg$/);
  await expectApplication(worker, 1, item.filename);
  await actionState(page, 'desktop', 'applying');
  await reply(worker, 1, compatible, { type: 'accepted' }, terminal('applied'));
  await actionState(page, 'desktop', 'applied');
  assert.ok(await page.locator('#wallpaper-actions-status').textContent());

  await desktopSwitch(options).uncheck();
  await setupState(options, 'off');
  await desktopButton(page).waitFor({ state: 'hidden' });
  await h.eventually(() => folder(options).isDisabled());
  assert.equal(await folder(options).inputValue(), 'Retained');
  await keyboardTargets(page, []);
  await downloadSwitch(options).check();
  await downloadButton(page).waitFor();
  assert.deepEqual(await downloadButton(page).boundingBox(), originalPosition);
  assert.equal(await folder(options).isEnabled(), true);
});

test('a desktop save held across Off, navigation, eviction and worker restart applies the original file once', async t => {
  const { worker, options, page } = await fixture(t, { enable_image_download: 'no' });
  await enableDesktop(options, page);
  const imageRequests = [];
  page.on('request', request => { if (h.IMAGE_REQUESTS.test(request.url())) imageRequests.push(request.url()); });
  await holdBrowserSave(page);
  await confirmDesktopAction(page);
  const id = await pendingDownload(page);
  await actionState(page, 'desktop', 'saving');
  assert.equal(await desktopButton(page).isDisabled(), true);
  await keyboardTargets(page, []);
  assert.equal((await hostCalls(worker)).length, 1);

  await desktopSwitch(options).uncheck();
  await setupState(options, 'off');
  await desktopButton(page).waitFor({ state: 'hidden' });
  await h.eventually(async () => await h.readLocal(hint) === false);
  await h.previous(page);
  await h.headlineIs(page, older.headline);
  await h.writeSync({ enable_uhd_wallpaper: 'no' });
  await h.workerCaches([h.finalHd(older)], [older.date]);
  await h.displayStateWhen(page, snapshot => snapshot?.url === older.urls.highDef);
  await h.deleteCached([first.urls.ultraHighDef, first.urls.highDef]);
  const display = await h.readDisplayState(page);
  const background = await h.inlineBackground(page);
  assert.equal((await hostCalls(worker)).length, 1);

  await h.stopWorker();
  assert.equal((await downloadRecord(page, id)).state, 'in_progress');
  const restarted = await h.worker();
  await controlHost(restarted);
  assert.equal((await downloadRecord(page, id)).state, 'in_progress');
  assert.deepEqual(await hostCalls(restarted), []);
  imageRequests.length = 0;

  const chosenName = 'Chosen-by-browser.jpg';
  const existing = path.join(h.downloadDirectory, chosenName);
  const previousContents = Buffer.from('a previous user file');
  fs.mkdirSync(h.downloadDirectory, { recursive: true });
  fs.writeFileSync(existing, previousContents);
  await page.evaluate(({ id, chosenName }) => {
    globalThis.heldWallpaperDownloads.get(id)({ filename: chosenName, conflictAction: 'uniquify' });
  }, { id, chosenName });
  const item = await completeDownload(page, id, first);
  assert.equal(path.dirname(item.filename), h.downloadDirectory);
  assert.match(path.basename(item.filename), /^Chosen-by-browser \(\d+\)\.jpg$/);
  assert.deepEqual(fs.readFileSync(existing), previousContents);
  await expectApplication(restarted, 0, item.filename);
  await reply(restarted, 0, compatible, { type: 'accepted' }, terminal('applied'));
  await actionState(page, 'desktop', 'applied');

  assert.equal(await h.readLocal(hint), false);
  assert.equal(await desktopSwitch(options).isChecked(), false);
  assert.equal(await desktopButton(page).isVisible(), false);
  await page.evaluate(() => document.getElementById('desktop-wallpaper-btn').click());
  assert.equal((await hostCalls(restarted)).length, 1);
  assert.equal(await page.evaluate(async () => (await chrome.downloads.search({})).length), 1);
  assert.deepEqual(await h.readDisplayState(page), display);
  assert.equal(await h.inlineBackground(page), background);
  assert.deepEqual(imageRequests, []);
});

test('a real completion before the download ID and an overlapping change event apply the completed record once', async t => {
  const { worker, options, page } = await fixture(t);
  await enableDesktop(options, page);
  await page.evaluate(() => {
    const downloads = chrome.downloads;
    const initiate = downloads.download.bind(downloads);
    const search = downloads.search.bind(downloads);
    const addListener = downloads.onChanged.addListener.bind(downloads.onChanged);
    const completed = new Map();
    const race = globalThis.wallpaperCompletionRace = {};
    addListener(delta => {
      if (delta.state?.current === 'complete') completed.set(delta.id, delta);
    });
    downloads.onChanged.addListener = listener => {
      race.notify = listener;
      addListener(listener);
    };
    downloads.download = async options => {
      const id = await initiate(options);
      for (let attempt = 0; attempt < 150; attempt++) {
        const [item] = await search({ id });
        if (item?.state === 'complete' && completed.has(id)) {
          race.beforeId = completed.get(id);
          return id;
        }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      throw new Error('download did not complete before returning its ID');
    };
    downloads.search = async query => {
      const items = await search(query);
      if (query.id === race.beforeId?.id && !race.release) {
        await new Promise(resolve => { race.release = resolve; });
      }
      return items;
    };
  });

  await confirmDesktopAction(page);
  await page.waitForFunction(() => Boolean(globalThis.wallpaperCompletionRace.release));
  assert.equal((await hostCalls(worker)).length, 1);
  const id = await page.evaluate(() => {
    const race = globalThis.wallpaperCompletionRace;
    race.notify(race.beforeId);
    race.release();
    return race.beforeId.id;
  });
  const item = await completeDownload(page, id, first);
  await expectApplication(worker, 1, item.filename);
  await reply(worker, 1, compatible, { type: 'accepted' }, terminal('applied'));
  await actionState(page, 'desktop', 'applied');
  assert.equal((await hostCalls(worker)).length, 2);
});

test('failed, cancelled and unconfirmed browser saves never reach the helper', async t => {
  const { worker, options, page } = await fixture(t);
  await enableDesktop(options, page);
  await page.evaluate(() => {
    const original = chrome.downloads.download.bind(chrome.downloads);
    chrome.downloads.download = async () => { throw new Error('FILE_ACCESS_DENIED'); };
    globalThis.restoreWallpaperDownload = () => { chrome.downloads.download = original; };
  });
  await confirmDesktopAction(page);
  await actionState(page, 'save', 'failed');
  assert.ok(await page.locator('#wallpaper-actions-status').textContent());
  assert.equal((await hostCalls(worker)).length, 1);
  assert.equal(await h.readLocal(hint), true);
  await page.evaluate(() => globalThis.restoreWallpaperDownload());

  await holdBrowserSave(page);
  await confirmDesktopAction(page);
  const id = await pendingDownload(page);
  await page.evaluate(id => {
    globalThis.heldWallpaperDownloads.delete(id);
    return chrome.downloads.cancel(id);
  }, id);
  await actionState(page, 'save', 'cancelled');
  assert.equal((await downloadRecord(page, id)).error, 'USER_CANCELED');
  assert.equal((await hostCalls(worker)).length, 1);
  assert.equal(await h.readLocal(hint), true);

  await page.evaluate(() => { chrome.downloads.search = async () => []; });
  await confirmDesktopAction(page);
  await actionState(page, 'save', 'unconfirmed');
  assert.ok(await page.locator('#wallpaper-actions-status').textContent());
  assert.equal((await hostCalls(worker)).length, 1);
  assert.equal(await h.readLocal(hint), true);
});

test('a compatible file error keeps Setup enabled and an incompatible helper clears it', async t => {
  const { worker, options, page } = await fixture(t);
  await enableDesktop(options, page);
  const status = page.locator('#wallpaper-actions-status');

  await confirmDesktopAction(page);
  const firstSave = await completeDownload(page, await newDownload(page), first);
  await expectApplication(worker, 1, firstSave.filename);
  await reply(worker, 1, compatible, terminal('file-error'));
  await actionState(page, 'desktop', 'file-error');
  assert.equal(await status.textContent(), await page.evaluate(() => chrome.i18n.getMessage('wallpaper_desktop_file_error')));
  assert.equal(await h.readLocal(hint), true);
  assert.equal(await desktopSwitch(options).isChecked(), true);
  assert.equal(await desktopButton(page).isEnabled(), true);

  await confirmDesktopAction(page);
  const secondSave = await completeDownload(page, await newDownload(page, firstSave.id), first);
  await expectApplication(worker, 2, secondSave.filename);
  await reply(worker, 2, { ...compatible, canApplyWallpaper: false });
  await actionState(page, 'desktop', 'incompatible');
  await setupState(options, 'incompatible');
  assert.equal(await status.textContent(), await page.evaluate(() => chrome.i18n.getMessage('wallpaper_desktop_setup_required')));
  assert.equal(await h.readLocal(hint), false);
  assert.equal(await desktopSwitch(options).isChecked(), false);
  assert.equal(await desktopButton(page).isVisible(), false);
  assert.equal(await downloadButton(page).isEnabled(), true);
  assert.ok((await hostCalls(worker)).every(call => call.disconnected));
  await completeDownload(page, firstSave.id, first);
  await completeDownload(page, secondSave.id, first);
});

test('a compatible helper with no terminal response leaves the download and verified availability intact', async t => {
  const { worker, options, page } = await fixture(t);
  await enableDesktop(options, page);
  await worker.evaluate(() => {
    const setTimer = globalThis.setTimeout;
    globalThis.setTimeout = (callback, delay, ...args) => {
      if (delay === 30_000) globalThis.expireWallpaperApplication = () => callback(...args);
      return setTimer(callback, delay, ...args);
    };
  });
  await confirmDesktopAction(page);
  const item = await completeDownload(page, await newDownload(page), first);
  await expectApplication(worker, 1, item.filename);
  await reply(worker, 1, compatible, { type: 'accepted' });
  await actionState(page, 'desktop', 'applying');
  await worker.evaluate(() => globalThis.expireWallpaperApplication());
  await actionState(page, 'desktop', 'unconfirmed');

  assert.ok(await page.locator('#wallpaper-actions-status').textContent());
  assert.equal((await hostCalls(worker))[1].disconnected, true);
  assert.equal((await hostCalls(worker)).length, 2);
  assert.equal(await desktopButton(page).isEnabled(), true);
  assert.equal(await desktopSwitch(options).isChecked(), true);
  assert.equal(await h.readLocal(hint), true);
  await completeDownload(page, item.id, first);
  await h.restartWorker();
  const restarted = await h.worker();
  await controlHost(restarted);
  const fresh = await h.openNewTab();
  await h.showsFinal(fresh);
  await h.eventually(() => desktopButton(fresh).isEnabled());
  assert.deepEqual(await hostCalls(restarted), []);
});

test('an accepted wallpaper request remains connected after the originating tab closes', async t => {
  const { worker, options, page } = await fixture(t);
  await enableDesktop(options, page);
  await confirmDesktopAction(page);
  const item = await completeDownload(page, await newDownload(page), first);
  await expectApplication(worker, 1, item.filename);
  await reply(worker, 1, compatible, { type: 'accepted' });

  await page.close();
  assert.equal((await hostCalls(worker))[1].disconnected, false);
  await reply(worker, 1, terminal('applied'));
  assert.equal((await hostCalls(worker))[1].disconnected, true);
  assert.equal((await hostCalls(worker)).length, 2);
  await completeDownload(options, item.id, first);
  assert.equal(await h.readLocal(hint), true);
});
