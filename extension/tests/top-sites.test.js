import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SCRIPT = readFileSync(new URL('../scripts/main/top_sites.js', import.meta.url), 'utf8');

// Run top_sites.js against stubbed conf helpers and this device's permission.
function loadTopSites({ showTopSites, granted, removable = true }) {
  const page = { conf: { show_top_sites: showTopSites }, writes: [] };
  const context = vm.createContext({
    readConf: key => page.conf[key],
    writeConf: async (key, value) => {
      page.conf[key] = value;
      page.writes.push({ [key]: value });
    },
    chrome: {
      permissions: {
        contains: (permission, callback) => callback(granted),
        request: (permission, callback) => callback(true),
        remove: (permission, callback) => callback(removable)
      }
    }
  });
  vm.runInContext(SCRIPT, context);
  page.TopSites = context.TopSites;
  return page;
}

describe('top sites setting', () => {
  it('stays enabled in sync when this device lacks the permission', () => {
    const page = loadTopSites({ showTopSites: 'yes', granted: false });
    let shown;
    page.TopSites.ensureEnabled(granted => { shown = granted; });

    assert.strictEqual(shown, false, 'hidden on this device');
    assert.deepStrictEqual(page.writes, [], 'the shared preference is not overwritten');
  });

  it('shows the list when enabled and permitted', () => {
    const page = loadTopSites({ showTopSites: 'yes', granted: true });
    let shown;
    page.TopSites.ensureEnabled(granted => { shown = granted; });
    assert.strictEqual(shown, true);
    assert.deepStrictEqual(page.writes, []);
  });

  it('writes the preference on an explicit close', () => {
    const page = loadTopSites({ showTopSites: 'yes', granted: true });
    page.TopSites.removePermission(() => {});
    assert.deepStrictEqual(page.writes, [{ show_top_sites: 'no' }]);
  });
});
