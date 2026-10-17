import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

describe('manifest', () => {
  it('does not allow the extension in incognito (ADR-0015)', () => {
    assert.strictEqual(manifest.incognito, 'not_allowed');
  });

  it('declares the Bing CDN host for worker image fetches (ADR-0001)', () => {
    assert.ok(manifest.host_permissions.includes('https://*.bing.net/'));
  });

  it('adds no permission for sync storage beyond storage', () => {
    assert.deepStrictEqual(manifest.permissions, ['storage']);
  });
});
