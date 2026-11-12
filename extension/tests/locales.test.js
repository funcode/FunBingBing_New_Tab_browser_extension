import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';

const locales = new URL('../_locales/', import.meta.url);
const { default_locale: defaultLocale } = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const readCatalog = locale => JSON.parse(readFileSync(new URL(`${locale}/messages.json`, locales), 'utf8'));

test('bundled locales have the default catalog keys and nonempty messages', () => {
  const defaultKeys = Object.keys(readCatalog(defaultLocale));
  assert.ok(defaultKeys.length, `The ${defaultLocale} catalog is empty`);

  for (const directory of readdirSync(locales, { withFileTypes: true }).filter(entry => entry.isDirectory())) {
    const locale = directory.name;
    const catalog = readCatalog(locale);
    const keys = Object.keys(catalog);
    assert.deepEqual(defaultKeys.filter(key => !Object.hasOwn(catalog, key)), [], `${locale} is missing messages`);
    assert.deepEqual(keys.filter(key => !defaultKeys.includes(key)), [], `${locale} has keys missing from ${defaultLocale}`);
    for (const [key, entry] of Object.entries(catalog)) {
      assert.ok(typeof entry?.message === 'string' && entry.message.trim(), `${locale}.${key} has an empty or invalid message`);
    }
  }
});
