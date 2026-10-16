import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  buildMigratedDisplayState,
  migrateSharedSetting,
  resolveSharedSettings,
  validateUrlSetting,
  validateYesNoSetting
} from '../src/helpers/migration.js';

describe('Migration helpers', () => {
  describe('migrateSharedSetting', () => {
    it('prefers valid sync value', () => {
      assert.strictEqual(migrateSharedSetting('no', 'yes', 'yes', validateYesNoSetting), 'no');
    });

    it('falls back to valid local value when sync invalid', () => {
      assert.strictEqual(migrateSharedSetting('invalid', 'no', 'yes', validateYesNoSetting), 'no');
    });

    it('uses default when both sync and local invalid', () => {
      assert.strictEqual(migrateSharedSetting(true, undefined, 'yes', validateYesNoSetting), 'yes');
    });
  });

  describe('validateYesNoSetting', () => {
    it('accepts the stored strings "yes" and "no"', () => {
      assert.strictEqual(validateYesNoSetting('yes'), true);
      assert.strictEqual(validateYesNoSetting('no'), true);
    });

    it('rejects anything else', () => {
      assert.strictEqual(validateYesNoSetting(true), false);
      assert.strictEqual(validateYesNoSetting('true'), false);
      assert.strictEqual(validateYesNoSetting(''), false);
      assert.strictEqual(validateYesNoSetting(null), false);
    });
  });

  describe('validateUrlSetting', () => {
    it('validates proper URLs', () => {
      assert.strictEqual(validateUrlSetting('https://example.com'), true);
      assert.strictEqual(validateUrlSetting('https://example.com/path'), true);
    });

    it('rejects javascript: scheme — only HTTPS is valid', () => {
      assert.strictEqual(validateUrlSetting('javascript:alert(1)'), false);
      assert.strictEqual(validateUrlSetting('http://example.com'), false);
    });
  });

  describe('resolveSharedSettings', () => {
    it('resolves each shared setting independently: sync, then local, then default', () => {
      const result = resolveSharedSettings(
        { show_clock: 'no', show_quote: 'off', search_engine_list: [] },
        { show_clock: 'yes', show_quote: 'no', current_search_engine: '', qotd_url: 'https://q.example/a.json' }
      );
      assert.strictEqual(result.show_clock, 'no');
      assert.strictEqual(result.show_quote, 'no');
      assert.strictEqual(result.current_search_engine, 'Bing');
      assert.strictEqual(result.qotd_url, 'https://q.example/a.json');
      assert.deepStrictEqual(result.search_engine_list.map(engine => engine.name), ['Bing', 'Google']);
      assert.deepStrictEqual(Object.keys(result).sort(), [
        'current_search_engine', 'display_search_box', 'enable_uhd_wallpaper', 'qotd_url',
        'search_engine_list', 'show_clock', 'show_quote', 'show_top_sites'
      ]);
    });

    it('accepts a custom engine list and rejects engines without a name', () => {
      const custom = [{ name: 'DuckDuckGo', action: 'https://duckduckgo.com/', param_name: 'q' }];
      assert.deepStrictEqual(resolveSharedSettings({}, { search_engine_list: custom }).search_engine_list, custom);
      const unnamed = resolveSharedSettings({}, { search_engine_list: [{ action: 'https://x.example/' }] });
      assert.deepStrictEqual(unnamed.search_engine_list.map(engine => engine.name), ['Bing', 'Google']);
    });
  });

  describe('buildMigratedDisplayState', () => {
    const ts1 = id => `https://ts1.tc.mm.bing.net/th?id=${id}`;
    const SHOWN = 'OHR.Shown_ZH-CN1';
    const LATEST = 'OHR.Latest_ZH-CN2';
    const catalog = {
      entries: {
        20261015: { date: '20261015', imageId: LATEST },
        20261013: { date: '20261013', imageId: SHOWN }
      }
    };
    const EMPTY = { date: '', imageId: '', url: '', preloadDataUrl: '', updatedAt: 0 };

    it('finds the displayed entry by the legacy URL identity, whatever the legacy refresh date', () => {
      const state = buildMigratedDisplayState(catalog, { wallpaperUrl: ts1(`${SHOWN}_UHD.jpg`), wallpaperDate: '20261015' }, false);
      assert.deepStrictEqual(state, { date: '20261013', imageId: SHOWN, url: ts1(`${SHOWN}_UHD.jpg`), preloadDataUrl: '', updatedAt: 0 });
    });

    it('rebuilds the canonical final URL from an older legacy host', () => {
      const state = buildMigratedDisplayState(catalog, {
        wallpaperUrl: `https://cn.bing.com/th?id=${SHOWN}_1920x1080.jpg`, wallpaperDate: '20261015'
      }, true);
      assert.strictEqual(state.url, ts1(`${SHOWN}_1920x1080.jpg`));
    });

    it('uses the legacy date only without a legacy URL, at the configured resolution', () => {
      assert.deepStrictEqual(buildMigratedDisplayState(catalog, { wallpaperDate: '20261015' }, true),
        { date: '20261015', imageId: LATEST, url: ts1(`${LATEST}_UHD.jpg`), preloadDataUrl: '', updatedAt: 0 });
      assert.strictEqual(buildMigratedDisplayState(catalog, { wallpaperDate: '20261015' }, false).url, ts1(`${LATEST}_1920x1080.jpg`));
    });

    it('transfers a valid suffixed display snapshot of an earlier v2 build before the v1 inputs', () => {
      const suffixed = { date: '20261015', imageId: LATEST, url: ts1(`${LATEST}_UHD.jpg`), preloadDataUrl: 'data:image/jpeg;base64,AAAA', updatedAt: 7 };
      assert.deepStrictEqual(buildMigratedDisplayState(catalog, {
        displayState: suffixed, wallpaperUrl: ts1(`${SHOWN}_UHD.jpg`), wallpaperDate: '20261015'
      }, true), suffixed);
      assert.strictEqual(buildMigratedDisplayState(catalog, {
        displayState: { ...suffixed, imageId: 'bad' }, wallpaperUrl: ts1(`${SHOWN}_UHD.jpg`)
      }, true).imageId, SHOWN);
    });

    it('is the explicit empty state when no catalog entry has the legacy identity', () => {
      assert.deepStrictEqual(buildMigratedDisplayState(catalog, { wallpaperUrl: ts1('OHR.Gone_ZH-CN3_UHD.jpg'), wallpaperDate: '20261015' }, true), EMPTY);
      assert.deepStrictEqual(buildMigratedDisplayState(catalog, { wallpaperDate: '20000101' }, true), EMPTY);
      assert.deepStrictEqual(buildMigratedDisplayState(undefined, {}, true), EMPTY);
    });
  });
});
