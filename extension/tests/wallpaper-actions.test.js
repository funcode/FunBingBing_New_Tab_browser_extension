import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { captureVisibleFinal, mountWallpaperActions } from '../src/page/wallpaper-actions.js';
import { mountWallpaperActionSettings } from '../src/page/wallpaper-action-settings.js';
import { buildCanonicalUrls } from '../src/helpers/image.js';

const messages = JSON.parse(readFileSync(new URL('../_locales/en/messages.json', import.meta.url), 'utf8'));

function event() {
  const listeners = new Set();
  return { addListener: listener => listeners.add(listener), removeListener: listener => listeners.delete(listener),
    emit: (...args) => { for (const listener of listeners) listener(...args); } };
}
class Element extends EventTarget {
  constructor() { super(); this.dataset = {}; this.attributes = {}; this.value = ''; this.textContent = ''; this.checked = false; }
  setAttribute(key, value) { this.attributes[key] = value; }
  hasAttribute(key) { return key in this.attributes; }
  showModal() { this.open = true; }
  close() { this.open = false; }
  click() { this.dispatchEvent(new Event('click')); }
  change() { this.dispatchEvent(new Event('change')); }
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const imageId = 'OHR.Selected_ZH-CN1';
const urls = buildCanonicalUrls(imageId);
const visible = Object.freeze({ date: '20261110', imageId, url: urls.highDef, blob: new Blob(['clicked image']) });
function fixture({ granted = false, contains, request = async () => true } = {}) {
  const elements = new Map();
  const el = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  const window = new EventTarget();
  window.CustomEvent = CustomEvent;
  window.setTimeout = (callback, delay) => {
    const timer = setTimeout(callback, delay);
    timer.unref?.();
    return timer;
  };
  window.clearTimeout = timer => clearTimeout(timer);
  const document = { getElementById: el, documentElement: { dataset: { networkStatus: 'online' } } };
  const conf = { enable_uhd_wallpaper: 'no', enable_image_download: 'yes', wallpaper_download_folder: '' };
  const state = { window, document, el, conf, visible, calls: [], requests: [], saved: [], availability: 'unavailable', applied: [] };
  const chrome = {
    i18n: { getMessage: key => messages[key]?.message ?? '' },
    permissions: { contains: contains ?? (async () => granted), request(options) { state.requests.push(options); return request(); }, onAdded: event(), onRemoved: event() },
    downloads: { onChanged: event(), onErased: event(), async download(options) { state.calls.push(options); return 5; }, async search() { return [{ id: 5, state: 'complete', filename: 'C:\\Downloads\\actual.jpg' }]; } },
    storage: { onChanged: event() }
  };
  state.chrome = chrome;
  state.readSetting = key => conf[key];
  state.writeSetting = async (key, value) => { conf[key] = value; };
  state.readVisibleFinal = () => state.visible;
  state.subscribeVisibleFinal = listener => { state.sourceChanged = listener; return () => {}; };
  state.desktopAvailability = {
    read: () => state.availability,
    subscribe: listener => { state.availabilityChanged = listener; return () => {}; },
    apply: async save => { state.applied.push(save); }
  };
  window.addEventListener('funbingbing:wallpapersaved', ev => state.saved.push(ev.detail));
  state.change = keys => window.dispatchEvent(new CustomEvent('funbingbing:settingschange', { detail: { keys } }));
  state.mount = () => mountWallpaperActions(state);
  return state;
}

describe('visible final capture', () => {
  it('captures configured HD/UHD and the same immutable bytes synchronously', () => {
    const capture = captureVisibleFinal(visible, 'no', false);
    assert.equal(capture.blob, visible.blob);
    assert.equal(capture.imageId, imageId);
    assert.equal(capture.resolution, 'highDef');
    assert.ok(Object.isFrozen(capture));
    assert.equal(captureVisibleFinal({ ...visible, url: urls.ultraHighDef }, 'yes', false).resolution, 'ultraHighDef');
  });
  it('rejects preview/fallback, resolution mismatch and offline-hidden final images', () => {
    assert.equal(captureVisibleFinal(null, 'no', false), null);
    assert.equal(captureVisibleFinal({ ...visible, url: urls.preview }, 'no', false), null);
    assert.equal(captureVisibleFinal(visible, 'yes', false), null);
    assert.equal(captureVisibleFinal(visible, 'no', true), null);
  });
});

describe('wallpaper action controls', () => {
  it('does not wait for permission reads or request permission during setup/hover/focus', () => {
    const state = fixture({ contains: () => new Promise(() => {}) });
    state.mount();
    assert.equal(state.el('download-image-btn').disabled, false);
    state.el('wallpaper-actions').dispatchEvent(new Event('mouseover'));
    state.el('download-image-btn').dispatchEvent(new Event('focus'));
    assert.equal(state.requests.length, 0);
  });
  it('captures the original click before explanation and requests permission in Continue gesture', async () => {
    let gesture = false;
    const state = fixture({ request: async () => { assert.equal(gesture, true); return true; } });
    state.mount();
    await tick();
    state.el('download-image-btn').click();
    assert.equal(state.el('wallpaper-download-permission-dialog').open, true);
    assert.equal(state.requests.length, 0);
    state.visible = Object.freeze({ ...visible, date: '20261109', blob: new Blob(['newer image']) });
    state.conf.enable_uhd_wallpaper = 'yes';
    state.conf.wallpaper_download_folder = 'Later';
    state.sourceChanged();
    gesture = true;
    state.el('wallpaper-download-permission-continue').click();
    gesture = false;
    await tick();
    assert.equal(state.calls.length, 1);
    assert.equal(state.saved.length, 1);
    assert.equal(state.saved[0].capture.date, visible.date);
    assert.equal(state.saved[0].capture.resolution, 'highDef');
    assert.equal(await state.saved[0].capture.blob.text(), 'clicked image');
    assert.ok(!state.calls[0].filename.startsWith('Later/'));
    assert.equal(state.saved[0].filename, 'C:\\Downloads\\actual.jpg');
  });
  it('explains permission denial without initiating a save', async () => {
    const state = fixture({ request: async () => false });
    state.mount();
    state.el('download-image-btn').click();
    state.el('wallpaper-download-permission-continue').click();
    await tick();
    assert.equal(state.el('wallpaper-actions').dataset.saveState, 'denied');
    assert.match(state.el('wallpaper-actions-status').textContent, /declined/);
    assert.equal(state.calls.length, 0);
    assert.equal(state.saved.length, 0);
  });
  it('clears the previous denial on retry and gives the new notice its full time', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const state = fixture({ request: async () => false });
    state.mount();
    const download = state.el('download-image-btn');
    const proceed = state.el('wallpaper-download-permission-continue');
    const status = state.el('wallpaper-actions-status');
    download.click();
    proceed.click();
    await tick();
    assert.match(status.textContent, /declined/);
    t.mock.timers.tick(4_000);
    download.click();
    assert.equal(status.textContent, '');
    proceed.click();
    await tick();
    t.mock.timers.tick(4_001);
    assert.match(status.textContent, /declined/);
    t.mock.timers.tick(3_999);
    assert.equal(status.textContent, '');
    assert.equal(download.disabled, false);
    assert.equal(state.calls.length, 0);
  });
  it('explains a permission request error without starting a save', async () => {
    const state = fixture({ request() { throw new Error('The permission prompt could not open.'); } });
    state.mount();
    state.el('download-image-btn').click();
    state.el('wallpaper-download-permission-continue').click();
    await tick();
    assert.match(state.el('wallpaper-actions-status').textContent, /could not.*request/i);
    assert.equal(state.calls.length, 0);
  });
  it('cancels the explanation without a permission request or tracked save', () => {
    const state = fixture();
    state.mount();
    state.el('download-image-btn').click();
    state.el('wallpaper-download-permission-cancel').click();
    assert.equal(state.el('wallpaper-actions-status').textContent, '');
    assert.equal(state.requests.length, 0);
    assert.equal(state.calls.length, 0);
  });
  it('derives both-off, loading, desktop-only and source availability without clock state', () => {
    const state = fixture();
    state.mount();
    state.availability = 'loading';
    state.availabilityChanged();
    assert.equal(state.el('download-image-btn').disabled, false);
    assert.equal(state.el('desktop-wallpaper-btn').hidden, true);
    state.conf.enable_image_download = 'no';
    state.change(['enable_image_download']);
    assert.equal(state.el('wallpaper-actions').hidden, true);
    assert.equal(state.el('download-image-btn').disabled, true);
    state.availability = 'available';
    state.availabilityChanged();
    assert.equal(state.el('wallpaper-actions').hidden, false);
    assert.equal(state.el('desktop-wallpaper-btn').disabled, false);
    state.conf.show_clock = 'no';
    state.change(['show_clock']);
    assert.equal(state.el('wallpaper-actions').hidden, false);
    state.visible = null;
    state.el('main-body').setAttribute('data-wallpaper-fallback', 'visible');
    state.sourceChanged();
    assert.equal(state.el('wallpaper-actions').dataset.sourceState, 'fallback');
    assert.equal(state.el('desktop-wallpaper-btn').disabled, true);
  });
  it('offers no enabled desktop no-op when a local availability hint has no apply capability', () => {
    const state = fixture();
    state.desktopAvailability = { read: () => 'available' };
    state.mount();
    assert.equal(state.el('desktop-wallpaper-btn').disabled, true);
  });
  it('uses the same completed-save boundary before fixture desktop application', async () => {
    const state = fixture({ granted: true });
    state.availability = 'available';
    state.conf.enable_image_download = 'no';
    state.mount();
    await tick();
    state.el('desktop-wallpaper-btn').click();
    assert.equal(state.applied.length, 0);
    await tick();
    assert.equal(state.saved.length, 1);
    assert.deepEqual(state.applied, state.saved);
  });
  it('updates loading status after a completed save and ignores a stale permission read', async () => {
    let resolveRead;
    const state = fixture({ contains: () => new Promise(resolve => { resolveRead = resolve; }) });
    state.mount();
    state.chrome.permissions.onAdded.emit({ permissions: ['downloads'] });
    resolveRead(false);
    await tick();
    state.el('download-image-btn').click();
    await tick();
    assert.equal(state.requests.length, 0);
    assert.equal(state.saved.length, 1);
    state.conf.enable_uhd_wallpaper = 'yes';
    state.change(['enable_uhd_wallpaper']);
    assert.equal(state.el('download-image-btn').disabled, true);
    assert.match(state.el('wallpaper-actions-status').textContent, /finish loading/);
  });
});

describe('wallpaper action settings', () => {
  it('saves the download switch and safe folder immediately while preserving both-off value', () => {
    const state = fixture();
    mountWallpaperActionSettings(state);
    const folder = state.el('wallpaper-download-folder');
    assert.equal(state.el('enable-image-download-checkbox').checked, true);
    assert.equal(folder.disabled, false);
    folder.value = 'Wallpapers\\Bing';
    folder.change();
    assert.equal(state.conf.wallpaper_download_folder, 'Wallpapers/Bing');
    state.el('enable-image-download-checkbox').checked = false;
    state.el('enable-image-download-checkbox').change();
    assert.equal(state.conf.enable_image_download, 'no');
    assert.equal(folder.disabled, true);
    assert.equal(folder.value, 'Wallpapers/Bing');
    state.availability = 'available';
    state.availabilityChanged();
    assert.equal(folder.disabled, false, 'desktop-only also permits folder editing');
  });
  it('rejects unsafe folder edits and follows external sync/local changes', () => {
    const state = fixture();
    delete state.desktopAvailability;
    state.conf.wallpaper_download_folder = 'Keep';
    mountWallpaperActionSettings(state);
    const folder = state.el('wallpaper-download-folder');
    folder.value = 'C:\\absolute';
    folder.change();
    assert.equal(state.conf.wallpaper_download_folder, 'Keep');
    assert.equal(folder.attributes['aria-invalid'], 'true');
    assert.match(state.el('wallpaper-download-folder-error').textContent, /relative/);
    state.conf.wallpaper_download_folder = 'Other';
    state.conf.enable_image_download = 'no';
    state.change(['enable_image_download', 'wallpaper_download_folder']);
    assert.equal(folder.value, 'Other');
    assert.equal(folder.disabled, true);
    assert.equal(state.el('enable-desktop-wallpaper-checkbox').disabled, true);
    state.conf.desktop_wallpaper_available = true;
    state.chrome.storage.onChanged.emit({ desktop_wallpaper_available: { newValue: true } }, 'local');
    assert.equal(folder.disabled, false);
  });
});
