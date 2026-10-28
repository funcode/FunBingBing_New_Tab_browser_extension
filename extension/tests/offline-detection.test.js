import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SCRIPT = readFileSync(new URL('../scripts/offline-detection.js', import.meta.url), 'utf8');

// Load the classic page script with stubbed browser globals. `connected`
// decides the result of the 15-second actual-connection check.
function loadPage({ onLine, connected, localStorage = new Map(), pendingCheck = null }) {
  const windowListeners = {};
  const intervals = [];
  const sentMessages = [];
  const storageWrites = [];
  const state = { connected };
  const context = {
    console: { log() {}, warn() {} },
    navigator: { onLine },
    localStorage: {
      getItem: key => localStorage.get(key) ?? null,
      setItem: (key, value) => localStorage.set(key, value)
    },
    document: { documentElement: { dataset: {} } },
    window: {
      addEventListener: (type, listener) => { windowListeners[type] = listener; },
      dispatchEvent() {}
    },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
    chrome: {
      storage: { local: { set: items => storageWrites.push(items) } },
      runtime: {
        lastError: undefined,
        sendMessage: (message, callback) => { sentMessages.push({ ...message }); callback?.({ ok: true }); }
      }
    },
    fetch: async () => {
      if (pendingCheck) await pendingCheck;
      if (!state.connected) throw new Error('offline');
      return { ok: true };
    },
    setInterval: (fn) => intervals.push(fn),
    setTimeout: (fn) => fn()
  };
  vm.runInNewContext(SCRIPT, context);
  return { windowListeners, intervals, sentMessages, storageWrites, state, document: context.document };
}

function settle() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

describe('offline detection reconnect', () => {
  it('starts a new tab offline immediately after another tab confirmed a connectivity failure', async () => {
    const localStorage = new Map();
    const first = loadPage({ onLine: true, connected: false, localStorage });
    await settle();
    assert.strictEqual(first.document.documentElement.dataset.networkStatus, 'offline');

    // The OS still reports online, and this tab has not received its probe result.
    const next = loadPage({ onLine: true, connected: false, localStorage, pendingCheck: new Promise(() => {}) });
    assert.strictEqual(next.document.documentElement.dataset.networkStatus, 'offline');
    assert.deepStrictEqual(next.sentMessages, []);
  });

  it('remembers native offline startup even when no connectivity probe runs', () => {
    const localStorage = new Map();
    loadPage({ onLine: false, connected: false, localStorage });
    const next = loadPage({ onLine: true, connected: false, localStorage, pendingCheck: new Promise(() => {}) });
    assert.strictEqual(next.document.documentElement.dataset.networkStatus, 'offline');
  });

  it('clears remembered offline status after a successful probe and refreshes once', async () => {
    const localStorage = new Map();
    loadPage({ onLine: true, connected: false, localStorage });
    await settle();
    const recovered = loadPage({ onLine: true, connected: true, localStorage });
    assert.strictEqual(recovered.document.documentElement.dataset.networkStatus, 'offline');
    await settle();
    assert.strictEqual(recovered.document.documentElement.dataset.networkStatus, 'online');
    assert.deepStrictEqual(recovered.sentMessages, [{ type: 'refreshWallpaperCatalog', reconnect: true }]);
    await recovered.intervals[0]();
    assert.strictEqual(recovered.sentMessages.length, 1);

    const next = loadPage({ onLine: true, connected: true, localStorage, pendingCheck: new Promise(() => {}) });
    assert.strictEqual(next.document.documentElement.dataset.networkStatus, 'online');
  });

  it('continues checking connectivity when localStorage is unavailable', async () => {
    const localStorage = { get() { throw new Error('unavailable'); }, set() { throw new Error('unavailable'); } };
    const page = loadPage({ onLine: true, connected: false, localStorage });
    await settle();
    assert.strictEqual(page.document.documentElement.dataset.networkStatus, 'offline');
    page.state.connected = true;
    await page.intervals[0]();
    assert.strictEqual(page.document.documentElement.dataset.networkStatus, 'online');
  });

  it('requests a reconnect catalog refresh when the online event follows offline', async () => {
    const page = loadPage({ onLine: false, connected: false });
    page.windowListeners.online();
    await settle();
    assert.deepStrictEqual(page.sentMessages, [{ type: 'refreshWallpaperCatalog', reconnect: true }]);
  });

  it('requests a reconnect catalog refresh when the periodic check recovers', async () => {
    const page = loadPage({ onLine: true, connected: false });
    await settle();
    assert.deepStrictEqual(page.sentMessages, []);

    page.state.connected = true;
    await page.intervals[0]();
    assert.deepStrictEqual(page.sentMessages, [{ type: 'refreshWallpaperCatalog', reconnect: true }]);

    // Staying online does not send again.
    await page.intervals[0]();
    assert.strictEqual(page.sentMessages.length, 1);
  });

  it('never writes Chrome storage when going offline or reconnecting', async () => {
    const page = loadPage({ onLine: false, connected: false });
    page.windowListeners.online();
    await settle();
    page.windowListeners.offline();
    await page.intervals[0]();
    assert.deepStrictEqual(page.storageWrites, []);
    assert.deepStrictEqual(page.sentMessages, [{ type: 'refreshWallpaperCatalog', reconnect: true }]);
  });

  it('does not request a refresh when the page starts online', async () => {
    const page = loadPage({ onLine: true, connected: true });
    await settle();
    await page.intervals[0]();
    assert.deepStrictEqual(page.sentMessages, []);
  });
});
