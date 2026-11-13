import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DESKTOP_WALLPAPER_AVAILABLE, DESKTOP_WALLPAPER_OFF_PENDING, NATIVE_WALLPAPER_PERMISSION
} from '../src/helpers/desktop-wallpaper-availability.js';
import { registerDesktopWallpaperSetup } from '../src/worker/desktop-wallpaper-setup.js';
import {
  VERIFICATION_TIMEOUT_MS, WALLPAPER_HOST, WALLPAPER_PROTOCOL_VERSION
} from '../src/worker/native-wallpaper.js';

const optionsUrl = 'chrome-extension://test/options.html';
const newTabSender = { id: 'test', url: 'chrome-extension://test/newtab.html', frameId: 0, tab: { id: 1 } };
const completedDownload = {
  id: 17, byExtensionId: 'test', state: 'complete', url: 'blob:chrome-extension://test/clicked', filename: 'C:\\Downloads\\photo.jpg'
};
const compatible = {
  type: 'compatibility', protocolVersion: WALLPAPER_PROTOCOL_VERSION, compatible: true, canApplyWallpaper: true
};
const settle = () => new Promise(resolve => setImmediate(resolve));

function event() {
  const listeners = new Set();
  return {
    addListener: listener => listeners.add(listener),
    removeListener: listener => listeners.delete(listener),
    emit(...args) { for (const listener of listeners) listener(...args); }
  };
}

function fixture({ hint, request = async () => true, write = async () => {}, download = completedDownload } = {}) {
  const state = { hint, offPending: false, statuses: [], ports: [], permissionsRequested: 0 };
  const onRemoved = event();
  const onMessage = event();
  const runtime = {
    id: 'test',
    getURL: file => `chrome-extension://test/${file}`,
    onMessage,
    async sendMessage({ status }) { state.statuses.push(status); },
    connectNative(name) {
      assert.equal(name, WALLPAPER_HOST);
      const port = {
        onMessage: event(), onDisconnect: event(), closed: false,
        postMessage(message) { port.request = message; },
        disconnect() { port.closed = true; }
      };
      state.ports.push(port);
      return port;
    }
  };
  registerDesktopWallpaperSetup({
    runtime,
    downloads: { search: async () => [await download] },
    permissions: {
      contains: async () => true,
      request: () => { state.permissionsRequested++; return request(); },
      onRemoved
    },
    storage: { local: {
      get: async () => ({
        [DESKTOP_WALLPAPER_AVAILABLE]: state.hint, [DESKTOP_WALLPAPER_OFF_PENDING]: state.offPending
      }),
      async set(values) {
        const available = values[DESKTOP_WALLPAPER_AVAILABLE];
        if (typeof available === 'boolean') {
          await write(available);
          state.hint = available;
        }
        if (DESKTOP_WALLPAPER_OFF_PENDING in values) {
          state.offPending = values[DESKTOP_WALLPAPER_OFF_PENDING];
        }
      }
    } }
  });
  state.send = (type, url = optionsUrl, frameId = 0) => onMessage.emit({ type }, { url, frameId }, () => {});
  state.apply = (sender = newTabSender, downloadUrl = completedDownload.url) => new Promise(resolve => {
    onMessage.emit({ type: 'applyDesktopWallpaper', downloadId: completedDownload.id, downloadUrl }, sender, resolve);
  });
  state.revoke = () => onRemoved.emit(NATIVE_WALLPAPER_PERMISSION);
  return state;
}

test('only explicit Setup checks launch a host and concurrent clicks share one attempt', async () => {
  const f = fixture();
  f.send('desktopWallpaperStatus');
  f.send('checkDesktopWallpaper', 'chrome-extension://test/newtab.html');
  f.send('checkDesktopWallpaper', optionsUrl, 3);
  await settle();
  assert.equal(f.permissionsRequested, 0);
  assert.equal(f.ports.length, 0);
  f.send('checkDesktopWallpaper');
  f.send('checkDesktopWallpaper');
  assert.equal(f.permissionsRequested, 1, 'the request starts inside the Setup message handler');
  await settle();
  assert.equal(f.ports.length, 1);
  assert.deepEqual(f.ports[0].request, { type: 'verify', protocolVersion: WALLPAPER_PROTOCOL_VERSION });
  assert.equal(f.hint, undefined);
  f.ports[0].onMessage.emit(compatible);
  await settle();
  assert.equal(f.hint, true);
  assert.equal(f.ports[0].closed, true);
  assert.deepEqual(f.statuses, ['idle', 'checking', 'verified']);
});

test('Setup rejects a verification-only helper and clears existing availability', async () => {
  const f = fixture({ hint: true });
  f.send('checkDesktopWallpaper');
  await settle();
  f.ports[0].onMessage.emit({ type: 'compatibility', protocolVersion: 1, compatible: true });
  await settle();
  assert.deepEqual(f.statuses, ['idle', 'checking', 'incompatible']);
  assert.equal(f.hint, false);
  assert.equal(f.ports[0].closed, true);
});

test('Off while permission is pending prevents a late grant from launching a host', async () => {
  const grant = Promise.withResolvers();
  const f = fixture({ request: () => grant.promise });
  f.send('checkDesktopWallpaper');
  f.send('disableDesktopWallpaper');
  grant.resolve(true);
  await settle();
  assert.equal(f.hint, false);
  assert.equal(f.ports.length, 0);
  assert.deepEqual(f.statuses, ['idle', 'checking', 'off']);
});

test('Off wins when a verified positive write is already in progress', async () => {
  const positive = Promise.withResolvers();
  const negative = Promise.withResolvers();
  const f = fixture({ write: available => available ? positive.promise : negative.promise });
  f.send('checkDesktopWallpaper');
  await settle();
  f.ports[0].onMessage.emit(compatible);
  await settle();
  f.send('disableDesktopWallpaper');
  positive.resolve();
  await settle();
  assert.equal(f.hint, true);
  assert.equal(f.offPending, true);
  negative.resolve();
  await settle();
  assert.equal(f.hint, false);
  assert.equal(f.offPending, false);
  assert.deepEqual(f.statuses, ['idle', 'checking', 'off']);
});

test('permission revocation cancels a held check and clears an existing hint', async () => {
  const f = fixture({ hint: true });
  f.send('checkDesktopWallpaper');
  await settle();
  f.revoke();
  f.ports[0].onMessage.emit(compatible);
  await settle();
  assert.equal(f.hint, false);
  assert.equal(f.ports[0].closed, true);
  assert.deepEqual(f.statuses, ['idle', 'checking', 'denied']);
});

test('a silent connection times out, disconnects and leaves the hint off without retry', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture({ hint: true });
  f.send('checkDesktopWallpaper');
  await settle();
  t.mock.timers.tick(VERIFICATION_TIMEOUT_MS);
  await settle();
  assert.equal(f.hint, false);
  assert.equal(f.ports[0].closed, true);
  assert.equal(f.ports.length, 1);
  assert.deepEqual(f.statuses, ['idle', 'checking', 'timeout']);
});

test('application resolves the browser record and rejects other sources or incomplete downloads', async () => {
  const invalidSender = fixture();
  void invalidSender.apply({ ...newTabSender, frameId: 1 });
  await settle();
  assert.equal(invalidSender.ports.length, 0);
  for (const download of [
    { ...completedDownload, state: 'in_progress' },
    { ...completedDownload, byExtensionId: 'other' },
    { ...completedDownload, url: 'blob:chrome-extension://test/other' },
    { ...completedDownload, filename: 'relative.jpg' }
  ]) {
    const f = fixture({ download });
    assert.equal(await f.apply(), 'save-unconfirmed');
    assert.equal(f.ports.length, 0);
  }
});

test('an old incompatible application cannot clear a newer successful recheck', async () => {
  const download = Promise.withResolvers();
  const f = fixture({ hint: true, download: download.promise });
  const result = f.apply();
  await settle();
  assert.equal(f.ports.length, 0);
  f.send('checkDesktopWallpaper');
  await settle();
  f.ports[0].onMessage.emit(compatible);
  await settle();
  download.resolve(completedDownload);
  await settle();
  assert.deepEqual(f.ports[1].request, {
    type: 'apply', protocolVersion: WALLPAPER_PROTOCOL_VERSION, path: completedDownload.filename
  });
  f.ports[1].onMessage.emit({ ...compatible, compatible: false });
  assert.equal(await result, 'incompatible');
  assert.equal(f.hint, true);
  assert.equal(f.statuses.at(-1), 'verified');
});
