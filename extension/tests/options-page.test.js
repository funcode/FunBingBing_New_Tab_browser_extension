import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SCRIPT = readFileSync(new URL('../scripts/option_page/main.js', import.meta.url), 'utf8');
const DISPLAY_STATE_KEY = 'wallpaper_display_state_v2';

// Run the options page script against stubbed conf helpers, DOM and runtime.
// `conf` holds the settings and local keys the page reads; `events` records
// conf writes, as they settle, and runtime messages in order.
function loadOptionsPage({ conf = {} } = {}) {
  const page = { conf: structuredClone(conf), events: [], alerts: [] };
  const elements = new Map();
  page.element = (id) => {
    if (!elements.has(id)) elements.set(id, { style: {}, checked: false, value: '', href: '', innerHTML: '' });
    return elements.get(id);
  };
  const context = vm.createContext({
    console,
    window: { DEFAULT_SEARCH_ENGINES: [] },
    document: { getElementById: page.element },
    CURRENT_BROWSER: 'chrome',
    CURRENT_VERSION: '1.7',
    CURRENT_LOCALE: 'en',
    i18n: key => key,
    alert: message => page.alerts.push(message),
    confirm: () => false,
    TopSites: { hasPermission() {} },
    readConf: key => page.conf[key],
    readStorageKey: async key => structuredClone(page.conf[key]),
    writeConf: async (key, value) => {
      page.conf[key] = value;
      await new Promise(resolve => setTimeout(resolve, 5));
      page.events.push({ write: key, value });
    },
    chrome: {
      runtime: {
        sendMessage: async (message) => {
          page.events.push({ message: structuredClone(message) });
          return { ok: true };
        }
      }
    }
  });
  vm.runInContext(SCRIPT, context);
  page.save = async () => {
    page.events.length = 0;
    await page.element('save-wallpaper-conf-btn').onclick();
    await new Promise(resolve => setTimeout(resolve, 20));
  };
  return page;
}

describe('options page wallpaper settings', () => {
  it('after a UHD change is written to sync, requests the display date in the new resolution', async () => {
    const page = loadOptionsPage({
      conf: { enable_uhd_wallpaper: 'no', show_clock: 'yes', show_quote: 'yes', [DISPLAY_STATE_KEY]: { date: '20261012', imageId: 'OHR.Older_ZH-CN1' } }
    });

    page.element('use-uhd-wallpaper-checkbox').checked = true;
    await page.save();

    const uhdWrite = page.events.findIndex(event => event.write === 'enable_uhd_wallpaper');
    const ensure = page.events.findIndex(event => event.message?.type === 'ensureWallpaperCached');
    assert.deepStrictEqual(page.events[uhdWrite], { write: 'enable_uhd_wallpaper', value: 'yes' });
    assert.ok(uhdWrite >= 0 && ensure > uhdWrite, 'the request follows the sync write');
    assert.deepStrictEqual(page.events[ensure].message, { type: 'ensureWallpaperCached', date: '20261012', resolution: 'ultraHighDef' });
    assert.deepStrictEqual(page.alerts, ['op_saved_alert']);
    assert.ok(!page.events.some(event => event.write === 'wallpaper_date'), 'no wallpaper_date sentinel');
  });

  it('requests HD after UHD is turned off', async () => {
    const page = loadOptionsPage({ conf: { enable_uhd_wallpaper: 'yes', [DISPLAY_STATE_KEY]: { date: '20261013' } } });

    page.element('use-uhd-wallpaper-checkbox').checked = false;
    await page.save();

    const ensures = page.events.filter(event => event.message?.type === 'ensureWallpaperCached');
    assert.deepStrictEqual(ensures, [{ message: { type: 'ensureWallpaperCached', date: '20261013', resolution: 'highDef' } }]);
  });

  it('requests no image when UHD is unchanged or nothing is displayed yet', async () => {
    const unchanged = loadOptionsPage({ conf: { enable_uhd_wallpaper: 'yes', [DISPLAY_STATE_KEY]: { date: '20261013' } } });
    unchanged.element('use-uhd-wallpaper-checkbox').checked = true;
    unchanged.element('show-clock-checkbox').checked = false;
    await unchanged.save();

    const empty = loadOptionsPage({ conf: { enable_uhd_wallpaper: 'yes', [DISPLAY_STATE_KEY]: { date: '', imageId: '' } } });
    empty.element('use-uhd-wallpaper-checkbox').checked = false;
    await empty.save();

    for (const page of [unchanged, empty]) {
      assert.ok(!page.events.some(event => event.message?.type === 'ensureWallpaperCached'));
      assert.ok(!page.events.some(event => event.write === 'wallpaper_date'), 'no wallpaper_date sentinel');
    }
    assert.ok(unchanged.events.some(event => event.write === 'show_clock' && event.value === 'no'));
  });
});
