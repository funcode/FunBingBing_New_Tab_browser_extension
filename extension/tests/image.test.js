import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  extractImageId,
  validateAndNormalizeSuffix,
  normalizeImageUrl,
  buildCanonicalUrls,
  isSameImage
} from '../src/helpers/image.js';

describe('Image helpers', () => {
  describe('extractImageId', () => {
    it('extracts OHR identity from Archive urlbase (no suffix)', () => {
      const id = extractImageId('/th?id=OHR.SantaCatalina_ZH-CN6223370790');
      assert.strictEqual(id, 'OHR.SantaCatalina_ZH-CN6223370790');
    });

    it('extracts OHR identity from IOTD URL — drops rf and pid params', () => {
      const id = extractImageId('/th?id=OHR.SantaCatalina_ZH-CN6223370790_1920x1080.jpg&rf=LaDigue_1920x1080.jpg&pid=hp');
      assert.strictEqual(id, 'OHR.SantaCatalina_ZH-CN6223370790');
    });

    it('extracts identities from approved HTTPS Bing URLs', () => {
      const id = extractImageId('https://ts1.tc.mm.bing.net/th?id=OHR.SantaCatalina_ZH-CN6223370790_1920x1080.webp');
      assert.strictEqual(id, 'OHR.SantaCatalina_ZH-CN6223370790');
    });

    it('rejects malformed, unsafe, and unknown-resolution inputs', () => {
      assert.strictEqual(extractImageId('junkOHR.Test_ZH-CN123'), null);
      assert.strictEqual(extractImageId('http://ts1.tc.mm.bing.net/th?id=OHR.Test_ZH-CN123_1920x1080.jpg'), null);
      assert.strictEqual(extractImageId('https://example.com/th?id=OHR.Test_ZH-CN123_1920x1080.jpg'), null);
      assert.strictEqual(extractImageId('/th?id=OHR.Test_ZH-CN123_1280x720'), null);
      assert.strictEqual(extractImageId('/th?id=OHR.Test_ZH-CN123_1280x720.jpg'), null);
      assert.strictEqual(extractImageId('no-ohr-here'), null);
      assert.strictEqual(extractImageId(''), null);
      assert.strictEqual(extractImageId(null), null);
    });

    it('handles full identities with multiple underscores', () => {
      const id = extractImageId('/th?id=OHR.AdorableOwlet_ZH-CN6929234033_1920x1080.jpg');
      assert.strictEqual(id, 'OHR.AdorableOwlet_ZH-CN6929234033');
    });

    it('does not truncate a percent-encoded underscore in the identity', () => {
      const id = extractImageId('/th?id=OHR.A%5FB');
      assert.strictEqual(id, 'OHR.A_B');
    });
  });

  describe('validateAndNormalizeSuffix', () => {
    it('validates supported suffixes', () => {
      assert.strictEqual(validateAndNormalizeSuffix('_640x360.jpg'), '_640x360.jpg');
      assert.strictEqual(validateAndNormalizeSuffix('_1920x1080.jpg'), '_1920x1080.jpg');
      assert.strictEqual(validateAndNormalizeSuffix('_UHD.jpg'), '_UHD.jpg');
    });

    it('normalizes webp to jpg for HD', () => {
      assert.strictEqual(validateAndNormalizeSuffix('_1920x1080.webp'), '_1920x1080.jpg');
    });

    it('rejects unknown suffixes', () => {
      assert.strictEqual(validateAndNormalizeSuffix('_1280x720.jpg'), null);
      assert.strictEqual(validateAndNormalizeSuffix('_unknown.jpg'), null);
      assert.strictEqual(validateAndNormalizeSuffix(''), null);
    });
  });

  describe('normalizeImageUrl', () => {
    it('normalizes to canonical resolution URLs', () => {
      const source = '/th?id=OHR.SantaCatalina_ZH-CN6223370790_1920x1080.jpg&rf=x&pid=hp';
      assert.strictEqual(normalizeImageUrl(source, 'preview'), 'https://ts1.tc.mm.bing.net/th?id=OHR.SantaCatalina_ZH-CN6223370790_640x360.jpg');
      assert.strictEqual(normalizeImageUrl(source, 'hd'), 'https://ts1.tc.mm.bing.net/th?id=OHR.SantaCatalina_ZH-CN6223370790_1920x1080.jpg');
      assert.strictEqual(normalizeImageUrl(source, 'uhd'), 'https://ts1.tc.mm.bing.net/th?id=OHR.SantaCatalina_ZH-CN6223370790_UHD.jpg');
    });

    it('rejects invalid inputs', () => {
      assert.strictEqual(normalizeImageUrl('invalid', 'hd'), null);
      assert.strictEqual(normalizeImageUrl('/th?id=OHR.Test', 'invalid'), null);
      assert.strictEqual(normalizeImageUrl('', 'hd'), null);
    });
  });

  describe('buildCanonicalUrls', () => {
    it('builds all three resolution URLs', () => {
      const urls = buildCanonicalUrls('OHR.SantaCatalina_ZH-CN6223370790');
      assert.strictEqual(urls.preview, 'https://ts1.tc.mm.bing.net/th?id=OHR.SantaCatalina_ZH-CN6223370790_640x360.jpg');
      assert.strictEqual(urls.highDef, 'https://ts1.tc.mm.bing.net/th?id=OHR.SantaCatalina_ZH-CN6223370790_1920x1080.jpg');
      assert.strictEqual(urls.ultraHighDef, 'https://ts1.tc.mm.bing.net/th?id=OHR.SantaCatalina_ZH-CN6223370790_UHD.jpg');
    });

    it('throws on invalid image identity', () => {
      assert.throws(() => buildCanonicalUrls('invalid'), /Invalid image identity/);
      assert.throws(() => buildCanonicalUrls(''), /Invalid image identity/);
      assert.throws(() => buildCanonicalUrls('OHR.Test_1280x720'), /Invalid image identity/);
    });
  });

  describe('isSameImage', () => {
    it('returns true for matching identities', () => {
      assert.strictEqual(isSameImage('OHR.Test_ZH-CN123', 'OHR.Test_ZH-CN123'), true);
    });

    it('returns false for different or invalid inputs', () => {
      assert.strictEqual(isSameImage('OHR.Test1_ZH-CN123', 'OHR.Test2_ZH-CN456'), false);
      assert.strictEqual(isSameImage('', 'OHR.Test'), false);
      assert.strictEqual(isSameImage(null, 'OHR.Test'), false);
    });
  });
});
