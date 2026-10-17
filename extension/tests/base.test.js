import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SCRIPT = readFileSync(new URL('../scripts/base.js', import.meta.url), 'utf8');

function storageArea(data, writes) {
  return {
    async get(key) {
      if (key == null) return structuredClone(data);
      const keys = Array.isArray(key) ? key : [key];
      return Object.fromEntries(keys.filter(k => k in data).map(k => [k, structuredClone(data[k])]));
    },
    async set(items) {
      writes.push(structuredClone(items));
      Object.assign(data, structuredClone(items));
    }
  };
}

// Run the classic page script that every extension page loads first, against
// mocked local and sync storage.
async function loadPage({ local = {}, sync = {}, version = '1.7' } = {}) {
  const page = { local: structuredClone(local), sync: structuredClone(sync), localWrites: [], syncWrites: [], listeners: [], events: [] };
  const context = vm.createContext({
    console: { log() {}, error: console.error },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
    chrome: {
      runtime: { getManifest: () => ({ version }) },
      i18n: { getMessage: () => 'en' },
      storage: {
        local: storageArea(page.local, page.localWrites),
        sync: storageArea(page.sync, page.syncWrites),
        onChanged: { addListener: listener => page.listeners.push(listener) }
      }
    }
  });
  context.globalThis = context;
  context.window = context;
  // Records the setting value each listener would read when the event fires.
  context.dispatchEvent = event => page.events.push({ type: event.type, keys: [...event.detail.keys], read: page.readConf?.('show_clock') });
  vm.runInContext(`${SCRIPT}\n;globalThis.__conf = { readConf, writeConf };`, context);
  await context.confReadyPromise;
  await new Promise(resolve => setTimeout(resolve, 0));
  page.readConf = key => structuredClone(context.__conf.readConf(key));
  page.writeConf = (key, value) => context.__conf.writeConf(key, value);
  page.change = (changes, area) => page.listeners.forEach(listener => listener(changes, area));
  return page;
}

describe('page configuration', () => {
  it('reads shared settings from sync, falling back to the local value, then the default', async () => {
    const page = await loadPage({
      local: { show_clock: 'no', show_quote: 'no', enable_uhd_wallpaper: 'no' },
      sync: { show_clock: 'yes', current_search_engine: 'Google' }
    });

    assert.strictEqual(page.readConf('show_clock'), 'yes', 'sync wins over local');
    assert.strictEqual(page.readConf('current_search_engine'), 'Google');
    assert.strictEqual(page.readConf('show_quote'), 'no', 'local before the migration wrote sync');
    assert.strictEqual(page.readConf('enable_uhd_wallpaper'), 'no');
    assert.strictEqual(page.readConf('display_search_box'), 'no', 'default');
    assert.strictEqual(page.readConf('qotd_url'), '');
    assert.deepStrictEqual(page.readConf('search_engine_list').map(engine => engine.name), ['Bing', 'Google']);
  });

  it('writes shared settings to sync and other keys to local', async () => {
    const page = await loadPage();

    await page.writeConf('enable_uhd_wallpaper', 'no');
    await page.writeConf('wallpaper_display_state_v2', { date: '20261013' });

    assert.deepStrictEqual(page.syncWrites, [{ enable_uhd_wallpaper: 'no' }]);
    assert.deepStrictEqual(page.localWrites, [{ wallpaper_display_state_v2: { date: '20261013' } }]);
    assert.strictEqual(page.readConf('enable_uhd_wallpaper'), 'no');
  });

  it('follows sync setting changes and ignores local copies of shared settings', async () => {
    const page = await loadPage({ local: { show_clock: 'no' }, sync: { show_clock: 'no' } });

    page.change({ show_clock: { newValue: 'yes' } }, 'sync');
    assert.strictEqual(page.readConf('show_clock'), 'yes');

    page.change({ show_clock: { oldValue: 'no' } }, 'local');
    page.change({ show_quote: { newValue: 'no' } }, 'local');
    assert.strictEqual(page.readConf('show_clock'), 'yes');
    assert.strictEqual(page.readConf('show_quote'), 'yes');

    page.change({ show_clock: { oldValue: 'yes' } }, 'sync');
    assert.strictEqual(page.readConf('show_clock'), 'yes', 'a removed sync value falls back to the default');

    page.change({ wallpaper_display_state_v2: { newValue: { date: '20261013' } } }, 'local');
    assert.deepStrictEqual(page.readConf('wallpaper_display_state_v2'), { date: '20261013' });
  });

  it('tells page consumers which shared settings changed in sync, after updating the cache', async () => {
    const page = await loadPage({ sync: { show_clock: 'yes' } });

    page.change({ show_clock: { newValue: 'no' }, display_search_box: { newValue: 'yes' }, unrelated: { newValue: 1 } }, 'sync');
    page.change({ show_quote: { newValue: 'no' } }, 'local');
    page.change({ unrelated: { newValue: 2 } }, 'sync');

    assert.deepStrictEqual(page.events, [{ type: 'funbingbing:settingschange', keys: ['show_clock', 'display_search_box'], read: 'no' }]);
  });

  it('writes no defaults or legacy wallpaper keys on a fresh install or an upgrade', async () => {
    const fresh = await loadPage();
    const upgraded = await loadPage({ local: { last_open_version: '1.6' }, version: '1.7' });

    for (const page of [fresh, upgraded]) {
      assert.deepStrictEqual(page.localWrites, []);
      assert.deepStrictEqual(page.syncWrites, []);
    }
  });
});
