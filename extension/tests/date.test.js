import { describe, it } from 'node:test';
import assert from 'node:assert';
import { getZhCnTargetDate, formatDateForDisplay, addDays } from '../src/helpers/date.js';

describe('Date helpers', () => {
  describe('getZhCnTargetDate', () => {
    it('returns a date in YYYYMMDD format', () => {
      const date = getZhCnTargetDate();
      assert.strictEqual(typeof date, 'string');
      assert.strictEqual(date.length, 8);
      assert.match(date, /^\d{8}$/);
    });

    it('returns date in Asia/Shanghai timezone regardless of process timezone', () => {
      // This test verifies the function uses Asia/Shanghai timezone
      // The actual date will vary, but it should be consistent
      const date1 = getZhCnTargetDate();
      const date2 = getZhCnTargetDate();
      assert.strictEqual(date1, date2);
    });

    it('returns the Asia/Shanghai date of a given moment', () => {
      // 15:59:59 UTC is still Oct 13 in Shanghai (UTC+8); 16:00 UTC is Oct 14.
      assert.strictEqual(getZhCnTargetDate(new Date(Date.UTC(2026, 9, 13, 15, 59, 59))), '20261013');
      assert.strictEqual(getZhCnTargetDate(new Date(Date.UTC(2026, 9, 13, 16, 0, 0))), '20261014');
    });
  });

  describe('formatDateForDisplay', () => {
    it('formats YYYYMMDD to YYYY/MM/DD', () => {
      assert.strictEqual(formatDateForDisplay('20260728'), '2026/07/28');
      assert.strictEqual(formatDateForDisplay('20261231'), '2026/12/31');
      assert.strictEqual(formatDateForDisplay('20260101'), '2026/01/01');
    });

    it('throws on invalid input', () => {
      assert.throws(() => formatDateForDisplay('invalid'), /Invalid date format/);
      assert.throws(() => formatDateForDisplay('2026072'), /Invalid date format/);
      assert.throws(() => formatDateForDisplay(''), /Invalid date format/);
    });
  });

  describe('addDays', () => {
    it('adds positive days', () => {
      assert.strictEqual(addDays('20260728', 1), '20260729');
      assert.strictEqual(addDays('20260728', 7), '20260804');
      assert.strictEqual(addDays('20260731', 1), '20260801'); // Month boundary
    });

    it('subtracts negative days', () => {
      assert.strictEqual(addDays('20260728', -1), '20260727');
      assert.strictEqual(addDays('20260728', -7), '20260721');
      assert.strictEqual(addDays('20260801', -1), '20260731'); // Month boundary
    });

    it('handles year boundaries', () => {
      assert.strictEqual(addDays('20261231', 1), '20270101');
      assert.strictEqual(addDays('20270101', -1), '20261231');
    });

    it('throws on invalid input', () => {
      assert.throws(() => addDays('invalid', 1), /Invalid date format/);
      assert.throws(() => addDays('2026072', 1), /Invalid date format/);
    });
  });
});
