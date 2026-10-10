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
    it('extracts OHR identity from Archive urlbase', () => {
      const id = extractImageId('/th?id=OHR.SantaCatalina_ZH-CN6223370790');
      assert.strictEqual(id, 'OHR.SantaCatalina_ZH-CN6223370790');
    });

    it('extracts OHR identity from IOTD URL with query params', () => {
      const id = extractImageId('/th?id=OHR.SantaCatalina_ZH-CN6223370790_1920x1080.jpg&rf=LaDigue_1920x1080.jpg&pid=hp');
      assert.strictEqual(id, 'OHR.SantaCatalina_ZH-CN6223370790');
    });

    it('handles full identities with multiple underscores', () => {
      const id = extractImageId('/th?id=OHR.AdorableOwlet_ZH-CN6929234033_1920x1080.jpg');
      assert.strictEqual(id, 'OHR.AdorableOwlet_ZH-CN6929234033');
    });

    it('returns null for invalid input', () => {
      assert.strictEqual(extractImageId('no-ohr-here'), null);
      assert.strictEqual(extractImageId(''), null);
      assert.strictEqual(extractImageId(null), null);
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
      assert.strictEqual(validateAndNormalizeSuffix('_unknown.jpg'), null);
      assert.strictEqual(validateAndNormalizeSuffix('_1280x720.jpg'), null);
      assert.strictEqual(validateAndNormalizeSuffix(''), null);
    });
  });

  describe('normalizeImageUrl', () => {
    it('normalizes to canonical preview URL', () => {
      const url = normalizeImageUrl('/th?id=OHR.SantaCatalina_ZH-CN6223370790_1920x1080.jpg&rf=x&pid=hp', 'preview');
      assert.strictEqual(url, 'https://ts1.tc.mm.bing.net/th?id=OHR.SantaCatalina_ZH-CN6223370790_640x360.jpg');
    });

    it('normalizes to canonical HD URL', () => {
      const url = normalizeImageUrl('/th?id=OHR.SantaCatalina_ZH-CN6223370790', 'hd');
      assert.strictEqual(url, 'https://ts1.tc.mm.bing.net/th?id=OHR.SantaCatalina_ZH-CN6223370790_1920x1080.jpg');
    });

    it('normalizes to canonical UHD URL', () => {
      const url = normalizeImageUrl('/th?id=OHR.SantaCatalina_ZH-CN6223370790', 'uhd');
      assert.strictEqual(url, 'https://ts1.tc.mm.bing.net/th?id=OHR.SantaCatalina_ZH-CN6223370790_UHD.jpg');
    });

    it('returns null for invalid inputs', () => {
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
    });
  });

  describe('isSameImage', () => {
    it('returns true for matching identities', () => {
      assert.strictEqual(isSameImage('OHR.Test_ZH-CN123', 'OHR.Test_ZH-CN123'), true);
    });

    it('returns false for different identities', () => {
      assert.strictEqual(isSameImage('OHR.Test1_ZH-CN123', 'OHR.Test2_ZH-CN456'), false);
    });

    it('returns false for invalid inputs', () => {
      assert.strictEqual(isSameImage('', 'OHR.Test'), false);
      assert.strictEqual(isSameImage(null, 'OHR.Test'), false);
    });
  });
});
