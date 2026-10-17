import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SCRIPT = readFileSync(new URL('../scripts/main/quick_links.js', import.meta.url), 'utf8');
const CATALOG_KEY = 'bing_wallpaper_catalog_v2';

function fakeElement(links) {
  const element = {
    style: {},
    childNodes: [],
    setAttribute() {},
    appendChild(child) {
      element.childNodes.push(child);
      return child;
    },
    addEventListener(type, listener) {
      if (type === 'click') links.push(element);
      element.click = () => listener({ preventDefault() {} });
    }
  };
  return element;
}

// Run quick_links.js in the page's shared global scope, where wallpaper.js
// declares CATALOG_KEY and the date of the image on screen.
function loadQuickLinks({ local = {}, displayedDate = null }) {
  const links = [];
  const opened = [];
  const context = vm.createContext({
    console: { log() {}, warn() {} },
    i18n: key => key,
    readConf: key => structuredClone(local[key]),
    TopSites: { ensureEnabled: callback => callback(false) },
    document: {
      getElementById: () => fakeElement(links),
      createElement: () => fakeElement(links),
      createElementNS: () => fakeElement(links),
      createTextNode: text => ({ text })
    },
    window: { open: url => opened.push(url) }
  });
  vm.runInContext(`const CATALOG_KEY = ${JSON.stringify(CATALOG_KEY)}; let currentImageDate = ${JSON.stringify(displayedDate)};`, context);
  vm.runInContext(SCRIPT, context);
  // The custom bookmarks are "history today", then "random Bing wallpaper".
  return { onThisDay: () => { links[0].click(); return opened.at(-1); }, random: () => { links[1].click(); return opened.at(-1); } };
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
});
