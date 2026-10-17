import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SCRIPT = readFileSync(new URL('../scripts/main/quick_links.js', import.meta.url), 'utf8');
const CATALOG_KEY = 'bing_wallpaper_catalog_v2';

function fakeElement(links, tag) {
  const element = {
    tag,
    style: {},
    childNodes: [],
    setAttribute() {},
    appendChild(child) {
      element.childNodes.push(child);
      child.parent = element;
      return child;
    },
    remove() {
      element.parent.childNodes = element.parent.childNodes.filter(child => child !== element);
    },
    addEventListener(type, listener) {
      if (type === 'click') links.push(element);
      element.click = () => listener({ preventDefault() {} });
    }
  };
  return element;
}

// Run quick_links.js in the page's shared global scope, where wallpaper.js
// declares CATALOG_KEY and the date of the image on screen. `conf` holds the
// shared settings and local keys the page reads; `granted` is the topSites
// permission of this device.
// With `deferTopSites`, the browser's top sites answer waits for `releaseTopSites()`.
function loadQuickLinks({ local = {}, displayedDate = null, granted = false, deferTopSites = false }) {
  const links = [];
  const opened = [];
  const listeners = [];
  const pendingTopSites = [];
  const conf = structuredClone(local);
  const popupDiv = fakeElement(links, 'div');
  const context = vm.createContext({
    console: { log() {}, warn() {} },
    i18n: key => key,
    readConf: key => structuredClone(conf[key]),
    TopSites: {
      isEnabled: () => conf.show_top_sites === 'yes',
      hasPermission: callback => callback(granted),
      ensureEnabled: callback => callback(conf.show_top_sites === 'yes' && granted)
    },
    chrome: {
      topSites: {
        get: (callback) => {
          const answer = () => callback([{ url: 'https://example.com/', title: 'Example' }]);
          if (deferTopSites) pendingTopSites.push(answer); else answer();
        }
      }
    },
    document: {
      getElementById: () => popupDiv,
      createElement: tag => fakeElement(links, tag),
      createElementNS: () => fakeElement(links, 'svg'),
      createTextNode: text => ({ text })
    },
    window: {
      open: url => opened.push(url),
      addEventListener: (type, listener) => { if (type === 'funbingbing:settingschange') listeners.push(listener); }
    }
  });
  vm.runInContext(`const CATALOG_KEY = ${JSON.stringify(CATALOG_KEY)}; let currentImageDate = ${JSON.stringify(displayedDate)};`, context);
  vm.runInContext(SCRIPT, context);
  return {
    // The custom bookmarks are "history today", then "random Bing wallpaper".
    onThisDay: () => { links[0].click(); return opened.at(-1); },
    random: () => { links[1].click(); return opened.at(-1); },
    // Number of top sites lists rendered: the custom bookmarks are the first list.
    topSitesLists: () => popupDiv.childNodes.filter(child => child.tag === 'ul').length - 1,
    releaseTopSites: () => pendingTopSites.splice(0).forEach(answer => answer()),
    syncChange: (key, value) => {
      conf[key] = value;
      listeners.forEach(listener => listener({ detail: { keys: [key] } }));
    }
  };
}

const catalog = {
  version: 2,
  entries: {
    '20261013': { date: '20261013', imageId: 'OHR.Target_ZH-CN1' },
    '20250704': { date: '20250704', imageId: 'OHR.Older_ZH-CN2' }
  }
};

describe('quick links', () => {
  it('resolve the catalog entry of the displayed date', () => {
    const page = loadQuickLinks({
      local: { [CATALOG_KEY]: catalog, bing_images: [{ isoDate: '20200101' }], wallpaper_idx: '0' },
      displayedDate: '20250704'
    });

    assert.match(page.onThisDay(), /OsKey%3A%22OnThisDay0704%22/);
    const random = page.random();
    assert.match(random, /^https:\/\/bing\.ee123\.net\/detail\/\d{4}0704$/);
    const year = Number(random.slice(-8, -4));
    assert.ok(year >= 2010 && year <= 2024, 'a random earlier year');
  });

  it("fall back to today's date without a displayed catalog entry", () => {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    for (const displayedDate of [null, '20240101']) {
      const page = loadQuickLinks({ local: { [CATALOG_KEY]: catalog, bing_images: [{ isoDate: '20200101' }], wallpaper_idx: '0' }, displayedDate });
      assert.match(page.onThisDay(), new RegExp(`OnThisDay${today.slice(4)}%22`));
    }
  });

  it('show or hide the top sites list when show_top_sites changes in sync', () => {
    const page = loadQuickLinks({ local: { show_top_sites: 'no' }, granted: true });
    assert.strictEqual(page.topSitesLists(), 0);

    page.syncChange('show_top_sites', 'yes');
    assert.strictEqual(page.topSitesLists(), 1);
    page.syncChange('show_top_sites', 'yes');
    assert.strictEqual(page.topSitesLists(), 1, 'rendered once');

    page.syncChange('show_top_sites', 'no');
    assert.strictEqual(page.topSitesLists(), 0);
  });

  it('drop a top sites answer that arrives after the setting was turned off', () => {
    const page = loadQuickLinks({ local: { show_top_sites: 'no' }, granted: true, deferTopSites: true });
    page.syncChange('show_top_sites', 'yes');
    page.syncChange('show_top_sites', 'no');
    page.releaseTopSites();
    assert.strictEqual(page.topSitesLists(), 0);
  });

  it('keep the top sites list hidden on a device without the permission', () => {
    const page = loadQuickLinks({ local: { show_top_sites: 'no' }, granted: false });
    page.syncChange('show_top_sites', 'yes');
    assert.strictEqual(page.topSitesLists(), 0);
  });
});
