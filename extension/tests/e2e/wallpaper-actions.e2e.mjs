import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  context, day, deleteCached, displayStateWhen, downloadDirectory,
  eventually, final, finalHd, finish, headlineIs, inlineBackground, jpeg, openNewTab,
  openOptions, previous, readDisplayState, readSync, restartWorker, seed,
  setBrowserDownloadDirectory, showsFinal, start, stopWorker,
  worker, workerCaches, writeSync
} from './harness.mjs';

const A = day(0, 'DownloadTarget', '#a03020');
const B = day(-1, 'DownloadOlder', '#2060a0');
const C = day(-2, 'DownloadOldest', '#208040');
const HD_A = { ...A, color: '#e09020' };
const HD_B = { ...B, color: '#8030b0' };
const HD_C = { ...C, color: '#a0d050' };
const evidenceDirectory = path.resolve('output', 'wallpaper-actions-acceptance');
const evidence = [];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
async function screenshot(page, name) {
  fs.mkdirSync(evidenceDirectory, { recursive: true });
  await page.screenshot({ path: path.join(evidenceDirectory, name), fullPage: true });
}
after(() => {
  fs.mkdirSync(evidenceDirectory, { recursive: true });
  fs.writeFileSync(path.join(evidenceDirectory, 'browser-save-evidence.json'), JSON.stringify({
    permissionFixture: 'Production manifest for controls/request/denial; copied production runtime with downloads promoted to required only for real-manager saves.',
    nativeUI: 'Native permission grant and native Save As chooser are not automated by these checks.',
    saves: evidence
  }, null, 2));
});
const group = page => page.locator('#wallpaper-actions');
const download = page => page.locator('#download-image-btn');
const saveState = (page, state) => page.waitForFunction(expected =>
  document.getElementById('wallpaper-actions').dataset.saveState === expected, state);
const ready = page => page.waitForFunction(() => !document.getElementById('download-image-btn').disabled);

async function localized(page, key) {
  const message = await page.evaluate(key => chrome.i18n.getMessage(key), key);
  assert.ok(message, `Missing translation for ${key}`);
  return message;
}

async function seedFinal(sync = {}, extra = {}) {
  await seed({ days: [A, B, C], cached: [final(A), final(B), final(C), finalHd(HD_A), finalHd(HD_B), finalHd(HD_C)],
    sync: { enable_uhd_wallpaper: 'yes', ...sync }, ...extra });
}

async function wallpaperOptions() {
  const page = await openOptions();
  await page.locator('#nav-wallpaper').click();
  return page;
}

async function observedTab(init) {
  const page = await context.newPage();
  await page.addInitScript(() => {
    const fetch = window.fetch.bind(window);
    window.fetch = (resource, options) => resource === 'https://www.bing.com/favicon.ico'
      ? Promise.resolve(new Response('', { status: 200 })) : fetch(resource, options);
    window.__wallpaperSaves = [];
    window.addEventListener('funbingbing:wallpapersaved', event => window.__wallpaperSaves.push(event.detail));
  });
  if (init) await page.addInitScript(init);
  await page.goto('chrome://newtab/');
  return page;
}

async function saved(page) {
  return page.evaluate(async () => Promise.all(window.__wallpaperSaves.map(async ({ capture, ...save }) => ({
    ...save, capture: { date: capture.date, imageId: capture.imageId, resolution: capture.resolution,
      base64: btoa(String.fromCharCode(...new Uint8Array(await capture.blob.arrayBuffer()))) }
  }))));
}

async function record(page, id) {
  return page.evaluate(async id => (await chrome.downloads.search({ id }))[0], id);
}

async function completedSave(page, expected, resolution = 'ultraHighDef') {
  await eventually(async () => (await saved(page)).length === 1, 'the completed-save boundary did not fire once');
  const [save] = await saved(page);
  await eventually(async () => (await record(page, save.downloadId))?.state === 'complete', 'Chrome did not complete saving');
  const item = await record(page, save.downloadId);
  assert.equal(save.filename, item.filename, 'the consumer receives Chrome’s actual completed filename');
  assert.ok(path.isAbsolute(save.filename));
  assert.deepEqual({ date: save.capture.date, imageId: save.capture.imageId, resolution: save.capture.resolution },
    { date: expected.date, imageId: expected.imageId, resolution });
  const expectedBytes = await jpeg(expected.color, 64);
  assert.deepEqual(fs.readFileSync(item.filename), expectedBytes);
  assert.deepEqual(Buffer.from(save.capture.base64, 'base64'), expectedBytes);
  assert.equal((await saved(page)).length, 1);
  evidence.push({ filename: item.filename, downloadId: item.id, state: item.state,
    capture: { date: save.capture.date, imageId: save.capture.imageId, resolution },
    fileSHA256: sha256(fs.readFileSync(item.filename)), capturedSHA256: sha256(Buffer.from(save.capture.base64, 'base64')),
    fixtureSHA256: sha256(expectedBytes), completionCount: (await saved(page)).length });
  return item;
}

/** Hold the real browser DownloadItem before its filename decision completes. */
async function holdBrowserSave(page) {
  await page.evaluate(() => {
    window.__heldDownloads = new Map();
    const listener = (item, suggest) => {
      window.__heldDownloads.set(item.id, { item, suggest });
      return true;
    };
    chrome.downloads.onDeterminingFilename.addListener(listener);
    window.__releaseBrowserSave = (id, filename) => {
      const held = window.__heldDownloads.get(id);
      if (!held) return;
      window.__heldDownloads.delete(id);
      held.suggest(filename ? { filename, conflictAction: 'uniquify' } : {});
    };
    window.__removeBrowserSaveHold = () => {
      chrome.downloads.onDeterminingFilename.removeListener(listener);
      for (const held of window.__heldDownloads.values()) held.suggest({});
      window.__heldDownloads.clear();
    };
  });
}

async function heldSave(page) {
  await page.waitForFunction(() => window.__heldDownloads?.size === 1);
  const id = await page.evaluate(() => [...window.__heldDownloads.keys()][0]);
  const item = await record(page, id);
  assert.equal(item.state, 'in_progress');
  assert.ok(item.bytesReceived > 0, 'the real browser download has already received bytes');
  assert.equal((await saved(page)).length, 0, 'an ID and received bytes are not completion');
  await saveState(page, 'saving');
  assert.equal(await page.locator('#wallpaper-actions-status').textContent(), '');
  return id;
}

async function focusDownloadWithTab(page) {
  await page.mouse.move(0, 0);
  for (let index = 0; index < 40; index++) {
    await page.keyboard.press('Tab');
    if (await download(page).evaluate(button => document.activeElement === button)) return;
  }
  assert.fail('Download image was not discoverable using only Tab');
}

async function keyboardDownload(page) {
  await focusDownloadWithTab(page);
  await page.waitForFunction(() => getComputedStyle(document.getElementById('wallpaper-actions')).opacity === '1');
  await screenshot(page, 'keyboard-focused-actions.png');
  await page.keyboard.press('Enter');
}

async function mountDesktopFixture(page, initial = 'unavailable') {
  await page.evaluate(async initial => {
    (await wallpaperActionsReady).dispose();
    const { mountWallpaperActions } = await import(chrome.runtime.getURL('src/page/wallpaper-actions.js'));
    let state = initial;
    const listeners = new Set();
    window.__desktopApplied = [];
    window.__setDesktopAvailability = value => { state = value; for (const listener of listeners) listener(); };
    window.__fixtureActions = mountWallpaperActions({ document, window, chrome, readSetting: readConf,
      readVisibleFinal: () => visibleWallpaperFinal,
      subscribeVisibleFinal(listener) { visibleWallpaperListeners.add(listener); return () => visibleWallpaperListeners.delete(listener); },
      desktopAvailability: { read: () => state, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        apply: async save => window.__desktopApplied.push(save) }
    });
  }, initial);
}

describe('wallpaper action controls with the production manifest', () => {
  before(async () => {
    await start();
    await context.addInitScript(() => {
      if (!globalThis.chrome?.i18n) return;
      const getMessage = chrome.i18n.getMessage.bind(chrome.i18n);
      chrome.i18n.getMessage = (key, ...args) => {
        const message = getMessage(key, ...args);
        return message && /^(op_)?wallpaper_/.test(key) ? `${message} [${key}]` : message;
      };
    });
  });
  after(finish);

  it('offers download by default and keeps its position when clock or desktop availability changes', async () => {
    await seedFinal();
    const page = await observedTab();
    try {
      await showsFinal(page); await ready(page);
      assert.equal(await group(page).getAttribute('aria-label'), await localized(page, 'wallpaper_actions'));
      for (const [id, key] of [['download-image-btn', 'wallpaper_download_image'], ['desktop-wallpaper-btn', 'wallpaper_set_as_desktop']]) {
        const button = page.locator(`#${id}`);
        const label = await localized(page, key);
        assert.equal(await button.getAttribute('aria-label'), label);
        assert.equal(await button.getAttribute('title'), label);
      }
      assert.equal(await page.locator('#desktop-wallpaper-btn').isVisible(), false);
      const box = await download(page).boundingBox();
      assert.ok(box);
      assert.equal(await page.evaluate(() => document.getElementById('center-clock').contains(document.getElementById('wallpaper-actions'))), false);
      await writeSync({ show_clock: 'no' });
      await page.waitForFunction(() => document.getElementById('center-clock').style.visibility === 'hidden');
      assert.deepEqual(await download(page).boundingBox(), box);
      await mountDesktopFixture(page, 'loading');
      assert.deepEqual(await download(page).boundingBox(), box);
      await page.evaluate(() => window.__setDesktopAvailability('available'));
      assert.deepEqual(await download(page).boundingBox(), box);
      assert.equal(await page.locator('#desktop-wallpaper-btn').isEnabled(), true);
      await page.evaluate(() => window.__setDesktopAvailability('unavailable'));
      assert.deepEqual(await download(page).boundingBox(), box);
      assert.equal(await page.locator('#desktop-wallpaper-btn').isVisible(), false);
    } finally { await page.close(); }
  });

  it('discovers the idle action by keyboard, explains permission, and requests only on Continue with user activation', async () => {
    await seedFinal({}, { cached: [final(A)] });
    const page = await observedTab(() => {
      window.__requests = [];
      chrome.permissions.contains = async () => false;
      chrome.permissions.request = details => {
        window.__requests.push({ details, active: navigator.userActivation.isActive });
        return new Promise(resolve => { window.__denyDownloads = () => resolve(false); });
      };
    });
    try {
      await showsFinal(page); await ready(page);
      assert.equal(await group(page).evaluate(element => getComputedStyle(element).opacity), '0');
      assert.deepEqual(await page.evaluate(() => window.__requests), []);
      await keyboardDownload(page);
      assert.equal(await page.locator('#wallpaper-download-permission-dialog').isVisible(), true);
      for (const [element, key] of [['title', 'wallpaper_save_title'], ['explanation', 'wallpaper_permission_explanation'],
        ['continue', 'wallpaper_permission_continue'], ['cancel', 'wallpaper_permission_cancel']]) {
        assert.equal(await page.locator(`#wallpaper-download-permission-${element}`).textContent(), await localized(page, key));
      }
      assert.equal(await page.locator('#wallpaper-actions-status').textContent(), '');
      assert.deepEqual(await page.evaluate(() => window.__requests), []);
      await page.locator('#wallpaper-download-permission-continue').press('Enter');
      await saveState(page, 'requesting-permission');
      assert.equal(await page.locator('#wallpaper-actions-status').textContent(), '');
      await writeSync({ enable_uhd_wallpaper: 'no' });
      await page.waitForFunction(() => document.getElementById('wallpaper-actions').dataset.sourceState === 'resolution-pending');
      await page.clock.install();
      await page.evaluate(() => window.__denyDownloads());
      await saveState(page, 'denied');
      assert.deepEqual(await page.evaluate(() => window.__requests), [{ details: { permissions: ['downloads'] }, active: true }]);
      assert.equal((await saved(page)).length, 0);
      const denial = await localized(page, 'wallpaper_permission_declined');
      assert.equal(await page.locator('#wallpaper-actions-status').textContent(), denial);
      await page.evaluate(() => document.activeElement.blur());
      await page.waitForFunction(() => getComputedStyle(document.getElementById('wallpaper-actions')).opacity === '1');
      assert.equal(await download(page).evaluate(button => getComputedStyle(button.parentElement).opacity), '0');
      await page.clock.fastForward(10_000);
      assert.notEqual(await page.locator('#wallpaper-actions-status').textContent(), denial);
      await page.waitForFunction(() => getComputedStyle(document.getElementById('wallpaper-actions')).opacity === '0');
    } finally { await page.close(); }
  });

  it('dismisses the permission explanation without leaving a message or starting a download', async () => {
    await seedFinal();
    const page = await observedTab(() => {
      window.__requests = 0;
      chrome.permissions.contains = async () => false;
      chrome.permissions.request = async () => { window.__requests++; return true; };
    });
    try {
      await showsFinal(page); await ready(page);
      const dialog = page.locator('#wallpaper-download-permission-dialog');
      for (const dismiss of [
        () => page.locator('#wallpaper-download-permission-cancel').click(),
        () => page.keyboard.press('Escape')
      ]) {
        await download(page).click();
        assert.equal(await dialog.isVisible(), true);
        await dismiss();
        assert.equal(await dialog.isVisible(), false);
        assert.equal(await page.locator('#wallpaper-actions-status').textContent(), '');
        assert.equal(await download(page).isEnabled(), true);
      }
      assert.equal(await page.evaluate(() => window.__requests), 0);
      assert.equal((await saved(page)).length, 0);
    } finally { await page.close(); }
  });

  it('dismisses permission denial on mouse entry and keyboard focus', async () => {
    await seedFinal();
    const page = await observedTab(() => {
      chrome.permissions.contains = async () => false;
      chrome.permissions.request = async () => false;
    });
    try {
      await showsFinal(page); await ready(page);
      await page.clock.install();
      const proceed = page.locator('#wallpaper-download-permission-continue');
      const status = page.locator('#wallpaper-actions-status');
      const denial = await localized(page, 'wallpaper_permission_declined');
      for (const dismiss of [() => group(page).hover(), () => focusDownloadWithTab(page)]) {
        await download(page).click();
        await proceed.click();
        await saveState(page, 'denied');
        await page.mouse.move(0, 0);
        assert.equal(await status.textContent(), denial);
        await dismiss();
        assert.equal(await status.textContent(), '');
        assert.equal(await download(page).isEnabled(), true);
      }
      assert.equal((await saved(page)).length, 0);
    } finally { await page.close(); }
  });

  it('replaces a denial on retry and gives the new feedback its full time', async () => {
    await seedFinal();
    const page = await observedTab(() => {
      let attempts = 0;
      chrome.permissions.contains = async () => false;
      chrome.permissions.request = async () => {
        if (attempts++ === 0) return false;
        throw new Error('Permission prompt failed to open');
      };
    });
    try {
      await showsFinal(page); await ready(page);
      await page.clock.install();
      const proceed = page.locator('#wallpaper-download-permission-continue');
      const status = page.locator('#wallpaper-actions-status');
      await download(page).click();
      await proceed.click();
      await saveState(page, 'denied');
      const denial = await localized(page, 'wallpaper_permission_declined');
      assert.equal(await status.textContent(), denial);
      await page.clock.fastForward(4_000);

      assert.equal(await status.textContent(), denial);
      await download(page).click();
      assert.equal(await status.textContent(), '', 'retry clears the previous feedback');
      await proceed.click();
      await saveState(page, 'failed');
      const failure = await localized(page, 'wallpaper_permission_failed');
      assert.equal(await status.textContent(), failure);
      await page.clock.fastForward(4_001);
      assert.equal(await status.textContent(), failure, 'the first deadline leaves the replacement visible');
      await page.clock.fastForward(4_000);
      assert.equal(await status.textContent(), '');
      assert.equal((await saved(page)).length, 0);
    } finally { await page.close(); }
  });

  it('propagates settings to open pages, applies folder logical OR, and retains the folder when both switches are off', async () => {
    await seedFinal();
    const options = await wallpaperOptions();
    const otherOptions = await wallpaperOptions();
    const page = await observedTab();
    try {
      await showsFinal(page); await ready(page);
      const image = options.locator('#enable-image-download-checkbox');
      const desktop = options.locator('#enable-desktop-wallpaper-checkbox');
      const folder = options.locator('#wallpaper-download-folder');
      assert.equal(await image.isChecked(), true);
      assert.equal(await desktop.isChecked(), false);
      await eventually(() => desktop.isEnabled());
      assert.equal(await folder.isEnabled(), true);
      await options.waitForFunction(() => document.getElementById('wallpaper-actions-heading')?.textContent);
      for (const [id, key] of [
        ['wallpaper-actions-heading', 'wallpaper_actions'],
        ['wallpaper-actions-apply-hint', 'op_wallpaper_actions_apply_immediately'],
        ['enable-image-download-label', 'wallpaper_download_image'],
        ['enable-desktop-wallpaper-label', 'op_wallpaper_desktop_enable'],
        ['desktop-wallpaper-setup-status', 'op_wallpaper_desktop_unavailable'],
        ['wallpaper-download-folder-label', 'op_wallpaper_download_folder_label'],
        ['wallpaper-download-folder-hint', 'op_wallpaper_download_folder_hint']
      ]) {
        assert.equal(await options.locator(`#${id}`).textContent(), await localized(options, key));
      }
      assert.equal(await folder.getAttribute('placeholder'), await localized(options, 'op_wallpaper_download_folder_example'));
      await screenshot(options, 'wallpaper-action-settings.png');
      await folder.fill('Pictures/Bing'); await folder.press('Tab');
      await eventually(async () => (await readSync('wallpaper_download_folder')).wallpaper_download_folder === 'Pictures/Bing');
      await otherOptions.waitForFunction(() => document.getElementById('wallpaper-download-folder').value === 'Pictures/Bing');
      await image.uncheck();
      await eventually(() => folder.isDisabled());
      await page.waitForFunction(() => document.getElementById('wallpaper-actions').hidden);
      assert.equal(await folder.inputValue(), 'Pictures/Bing');
      assert.equal(await folder.inputValue(), 'Pictures/Bing');
      await image.check();
      await ready(page);
      assert.equal(await folder.isEnabled(), true);
      await page.mouse.move(0, 0);
      await image.uncheck();
      await page.waitForFunction(() => document.getElementById('wallpaper-actions').hidden);
      for (let index = 0; index < 25; index++) {
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => document.activeElement?.closest('#wallpaper-actions') !== null), false);
      }
    } finally { await Promise.all([options.close(), otherOptions.close(), page.close()]); }
  });

  it('rejects absolute and traversing folders without replacing the last valid saved suggestion', async () => {
    await seedFinal({ wallpaper_download_folder: 'Retained' });
    const options = await wallpaperOptions();
    try {
      await options.clock.install();
      const folder = options.locator('#wallpaper-download-folder');
      for (const invalid of ['/absolute', 'C:\\Pictures', '\\\\server\\share', '../outside', 'a/../outside', 'bad:name']) {
        await folder.fill(invalid); await folder.press('Tab');
        await options.waitForFunction(() => document.getElementById('wallpaper-download-folder-error').textContent.trim().length > 0);
        assert.equal(await options.locator('#wallpaper-download-folder-error').textContent(), await localized(options, 'op_wallpaper_download_folder_invalid'));
        assert.equal((await readSync('wallpaper_download_folder')).wallpaper_download_folder, 'Retained');
      }
      await options.clock.fastForward(10_000);
      assert.equal(await options.locator('#wallpaper-download-folder-error').textContent(), '');
      assert.equal(await folder.getAttribute('aria-invalid'), 'true');
      await folder.fill(''); await folder.press('Tab');
      await eventually(async () => (await readSync('wallpaper_download_folder')).wallpaper_download_folder === '');
      assert.equal(await options.locator('#wallpaper-download-folder-error').textContent(), '');
    } finally { await options.close(); }
  });

  it('dismisses invalid-folder feedback on mouse entry and keyboard focus', async () => {
    await seedFinal({ wallpaper_download_folder: 'Retained' });
    const options = await wallpaperOptions();
    try {
      await options.clock.install();
      const folder = options.locator('#wallpaper-download-folder');
      const error = options.locator('#wallpaper-download-folder-error');
      const invalidMessage = await localized(options, 'op_wallpaper_download_folder_invalid');
      for (const [invalid, dismiss] of [
        ['../outside', () => folder.hover()],
        ['/absolute', () => options.keyboard.press('Tab')]
      ]) {
        await options.mouse.move(0, 0);
        await folder.fill(invalid);
        await folder.press('Shift+Tab');
        assert.equal(await error.textContent(), invalidMessage);
        await dismiss();
        assert.equal(await error.textContent(), '');
        assert.equal(await folder.getAttribute('aria-invalid'), 'true');
        assert.equal(await folder.inputValue(), invalid);
        assert.equal((await readSync('wallpaper_download_folder')).wallpaper_download_folder, 'Retained');
      }
    } finally { await options.close(); }
  });

  it('keeps preview-only, fallback, pending-resolution, and offline-hidden pictures unavailable', async () => {
    for (const fixture of [
      { days: [A], cached: [{ url: A.urls.preview, color: A.color, size: 16 }] },
      { days: [], cached: [] }
    ]) {
      await seed(fixture);
      const page = await observedTab();
      try {
        await page.waitForFunction(() => document.getElementById('wallpaper-actions').dataset.sourceState);
        assert.equal(await download(page).isDisabled(), true);
        assert.equal(await page.locator('#wallpaper-actions-status').textContent(), await localized(page, 'wallpaper_actions_loading'));
      } finally { await page.close(); }
    }
    await seedFinal({}, { cached: [finalHd(A)], sync: { enable_uhd_wallpaper: 'no' } });
    const page = await observedTab();
    try {
      await showsFinal(page); await ready(page);
      await writeSync({ enable_uhd_wallpaper: 'yes' });
      await page.waitForFunction(() => document.getElementById('download-image-btn').disabled);
      assert.equal(await group(page).getAttribute('data-source-state'), 'resolution-pending');
      await workerCaches([final(A)], [A.date]);
      await ready(page);
      await context.setOffline(true);
      await page.evaluate(() => window.dispatchEvent(new Event('offline')));
      await page.waitForFunction(() => document.documentElement.dataset.networkStatus === 'offline');
      assert.equal(await download(page).isDisabled(), true);
      assert.equal(await page.locator('#wallpaper-actions-status').textContent(), await localized(page, 'wallpaper_actions_offline'));
      assert.equal((await saved(page)).length, 0);
    } finally { await context.setOffline(false); await page.close(); }
  });

  it('does not delay the first final wallpaper while action permission discovery remains pending', async () => {
    await seedFinal();
    const page = await observedTab(() => {
      chrome.permissions.contains = () => new Promise(resolve => { window.__releasePermissionRead = () => resolve(false); });
    });
    try {
      await showsFinal(page);
      await page.waitForFunction(() => typeof window.__releasePermissionRead === 'function');
      assert.equal(await page.locator('#headline').textContent(), A.headline);
      await page.evaluate(() => window.__releasePermissionRead());
      await ready(page);
    } finally { await page.close(); }
  });
});

describe('wallpaper saves through Chrome’s real manager with a pre-granted API fixture', () => {
  before(() => start({ downloads: true }));
  after(finish);

  it('saves the configured HD bytes into Downloads root with a descriptive filename using only the keyboard', async () => {
    await seedFinal({ enable_uhd_wallpaper: 'no' });
    const page = await observedTab();
    const imageRequests = [];
    const observeImage = request => { if (/\.bing\.net\//.test(request.url())) imageRequests.push(request.url()); };
    try {
      await showsFinal(page); await ready(page);
      const background = await inlineBackground(page);
      const snapshot = await readDisplayState(page);
      context.on('request', observeImage);
      await keyboardDownload(page);
      const item = await completedSave(page, HD_A, 'highDef');
      assert.equal(await page.locator('#wallpaper-actions-status').textContent(), '');
      assert.notDeepEqual(fs.readFileSync(item.filename), await jpeg(A.color, 64));
      assert.equal(path.dirname(item.filename), downloadDirectory);
      assert.ok(path.basename(item.filename).includes(A.date));
      assert.match(path.basename(item.filename), /HD/i);
      assert.match(path.basename(item.filename), /DownloadTarget/i);
      assert.equal(await inlineBackground(page), background, 'saving does not repaint');
      assert.deepEqual(await readDisplayState(page), snapshot, 'saving does not publish display state');
      assert.deepEqual(imageRequests, [], 'the held HD Blob is saved without refetching or upgrading');
    } finally { context.off('request', observeImage); await page.close(); }
  });

  it('retains the first clicked source while a controlled permission result is pending and grants from Continue’s gesture', async () => {
    await seedFinal();
    const page = await observedTab(() => {
      const request = chrome.permissions.request.bind(chrome.permissions);
      chrome.permissions.contains = async () => false;
      chrome.permissions.request = details => {
        window.__grantGesture = navigator.userActivation.isActive;
        const granted = request(details);
        return new Promise(resolve => { window.__finishGrant = () => granted.then(resolve); });
      };
    });
    try {
      await showsFinal(page); await ready(page);
      await download(page).click();
      await page.locator('#wallpaper-download-permission-continue').click();
      await saveState(page, 'requesting-permission');
      assert.equal(await page.evaluate(() => window.__grantGesture), true);
      assert.equal((await saved(page)).length, 0);
      await previous(page); await headlineIs(page, B.headline);
      await writeSync({ enable_uhd_wallpaper: 'no' });
      await page.evaluate(() => window.__finishGrant());
      await completedSave(page, A);
    } finally { await page.close(); }
  });

  it('uses a relative subfolder and respects Chrome’s actual conflict renaming without overwriting a saved file', async () => {
    await seedFinal({ wallpaper_download_folder: 'Pictures/Bing' });
    const page = await observedTab();
    try {
      await showsFinal(page); await ready(page);
      await download(page).click();
      const first = await completedSave(page, A);
      assert.equal(path.dirname(first.filename), path.join(downloadDirectory, 'Pictures', 'Bing'));
      assert.match(path.basename(first.filename), /UHD/i);
      const sentinel = Buffer.from('previous user-owned file');
      fs.writeFileSync(first.filename, sentinel);
      await page.evaluate(() => { window.__wallpaperSaves = []; });
      await download(page).click();
      const second = await completedSave(page, A);
      assert.notEqual(second.filename, first.filename);
      assert.equal(path.dirname(second.filename), path.dirname(first.filename));
      assert.deepEqual(fs.readFileSync(first.filename), sentinel);
    } finally { await page.close(); }
  });

  it('retains original tab bytes through navigation, resolution change, cache eviction, another tab, and worker restart while a real save is pending', async () => {
    await seedFinal();
    const page = await observedTab();
    let other;
    try {
      await showsFinal(page); await ready(page);
      other = await observedTab();
      await showsFinal(other); await previous(other); await headlineIs(other, B.headline);
      await displayStateWhen(other, snapshot => snapshot?.date === B.date);
      await headlineIs(page, A.headline);
      await holdBrowserSave(page);
      await download(page).click();
      const id = await heldSave(page);
      const beforeRestart = await record(page, id);
      await previous(page); await headlineIs(page, B.headline);
      await writeSync({ enable_uhd_wallpaper: 'no' });
      await workerCaches([finalHd(HD_B), finalHd(HD_C)], [B.date, C.date]);
      await displayStateWhen(page, snapshot => snapshot?.date === B.date && snapshot.url === B.urls.highDef);
      await deleteCached([A.urls.ultraHighDef, A.urls.highDef]);
      await previous(other); await headlineIs(other, C.headline);
      await stopWorker();
      const afterStop = await record(page, id);
      assert.equal(afterStop.state, 'in_progress');
      assert.equal((await saved(page)).length, 0);
      await worker();
      const afterRestart = await record(page, id);
      assert.equal(afterRestart.state, 'in_progress');
      assert.equal((await saved(page)).length, 0);
      await page.evaluate(id => window.__releaseBrowserSave(id), id);
      const item = await completedSave(page, A);
      assert.equal(item.id, id);
      evidence.push({ pendingAcrossWorkerRestart: { downloadId: id,
        beforeRestart: { state: beforeRestart.state, bytesReceived: beforeRestart.bytesReceived },
        afterStop: { state: afterStop.state, bytesReceived: afterStop.bytesReceived },
        afterRestart: { state: afterRestart.state, bytesReceived: afterRestart.bytesReceived },
        completedFilename: item.filename, completionCount: (await saved(page)).length } });
      assert.equal((await saved(other)).length, 0);
      await restartWorker();
      assert.equal((await saved(page)).length, 1, 'worker recovery does not replay the completion boundary');
    } finally {
      await page.evaluate(() => window.__removeBrowserSaveHold?.()).catch(() => {});
      await other?.close(); await page.close();
    }
  });

  it('keeps a previous final selected while the next date has no final yet', async () => {
    await seedFinal({}, { cached: [final(A)] });
    const page = await observedTab();
    try {
      await showsFinal(page); await ready(page);
      const background = await inlineBackground(page);
      await previous(page);
      assert.equal(await inlineBackground(page), background);
      assert.equal(await download(page).isEnabled(), true);
      await download(page).click();
      await completedSave(page, A);
    } finally { await page.close(); }
  });

  it('cancels an actual pending browser download without crossing the completed-save boundary', async () => {
    await seedFinal();
    const page = await observedTab();
    try {
      await showsFinal(page); await ready(page);
      await holdBrowserSave(page); await download(page).click();
      const id = await heldSave(page);
      await page.evaluate(id => chrome.downloads.cancel(id), id);
      await saveState(page, 'cancelled');
      assert.equal(await page.locator('#wallpaper-actions-status').textContent(), '');
      assert.equal((await record(page, id)).state, 'interrupted');
      assert.equal((await record(page, id)).error, 'USER_CANCELED');
      assert.equal((await saved(page)).length, 0);
    } finally {
      await page.evaluate(() => window.__removeBrowserSaveHold?.()).catch(() => {});
      await page.close();
    }
  });

  it('reconciles a real browser completion that arrives before initiation returns its ID', async () => {
    await seedFinal();
    const page = await observedTab(() => {
      const initiate = chrome.downloads.download.bind(chrome.downloads);
      chrome.downloads.download = async options => {
        const id = await initiate(options);
        for (let attempt = 0; attempt < 150; attempt++) {
          const [item] = await chrome.downloads.search({ id });
          if (item?.state === 'complete') { window.__completeBeforeID = id; return id; }
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        throw new Error('the real download did not complete before returning its ID');
      };
    });
    try {
      await showsFinal(page); await ready(page); await download(page).click();
      const item = await completedSave(page, A);
      assert.equal(await page.evaluate(() => window.__completeBeforeID), item.id);
    } finally { await page.close(); }
  });

  it('renders controlled access and disk failures without emitting a completed save', async () => {
    for (const reason of ['FILE_ACCESS_DENIED', 'FILE_NO_SPACE']) {
      await seedFinal();
      const page = await observedTab();
      try {
        await page.evaluate(reason => {
          chrome.downloads.download = async () => { throw new Error(reason); };
        }, reason);
        await showsFinal(page); await ready(page); await page.clock.install(); await download(page).click();
        await saveState(page, 'failed');
        assert.equal((await saved(page)).length, 0);
        assert.equal(await page.locator('#wallpaper-actions-status').textContent(), await localized(page, 'wallpaper_save_failed'));
        await page.mouse.move(0, 0);
        await page.clock.fastForward(10_000);
        assert.equal(await page.locator('#wallpaper-actions-status').textContent(), '');
        await download(page).click();
        await saveState(page, 'failed');
        assert.equal(await page.locator('#wallpaper-actions-status').textContent(), await localized(page, 'wallpaper_save_failed'));
        await page.mouse.move(0, 0);
        await group(page).hover();
        assert.equal(await page.locator('#wallpaper-actions-status').textContent(), '');
      } finally { await page.close(); }
    }
  });

  it('uses the actual browser-policy destination instead of assuming its suggested folder was used', async () => {
    await seedFinal({ wallpaper_download_folder: 'Suggested/Folder' });
    const page = await observedTab();
    const chosen = path.join(downloadDirectory, 'browser-policy-destination');
    fs.mkdirSync(chosen, { recursive: true });
    try {
      await setBrowserDownloadDirectory(chosen);
      await showsFinal(page); await ready(page); await download(page).click();
      const item = await completedSave(page, A);
      assert.equal(path.dirname(item.filename), chosen);
    } finally { await setBrowserDownloadDirectory(); await page.close(); }
  });

  it('does not hand a controlled desktop consumer a pending save, then hands it the completed absolute browser filename once', async () => {
    await seedFinal();
    const page = await observedTab();
    try {
      await showsFinal(page); await mountDesktopFixture(page, 'available');
      await holdBrowserSave(page);
      await page.locator('#desktop-wallpaper-btn').click();
      const id = await heldSave(page);
      assert.equal(await page.evaluate(() => window.__desktopApplied.length), 0);
      await page.evaluate(id => window.__releaseBrowserSave(id), id);
      const item = await completedSave(page, A);
      await eventually(async () => await page.evaluate(() => window.__desktopApplied.length) === 1);
      assert.deepEqual(await page.evaluate(() => window.__desktopApplied.map(({ downloadId, filename }) => ({ downloadId, filename }))),
        [{ downloadId: item.id, filename: item.filename }]);
    } finally {
      await page.evaluate(() => window.__removeBrowserSaveHold?.()).catch(() => {});
      await page.close();
    }
  });
});
