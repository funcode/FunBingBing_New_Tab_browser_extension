import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  TASK_PRIORITY,
  resolveImageTaskAction,
  shouldCacheFetchResponse
} from '../src/helpers/image-task.js';

describe('Image task helpers', () => {
  describe('resolveImageTaskAction', () => {
    it('returns create when no task exists for the URL', () => {
      const taskMap = new Map();
      assert.strictEqual(resolveImageTaskAction(taskMap, 'https://example.com/img.jpg', false), 'create');
    });

    it('returns create for urgent request with no existing task', () => {
      const taskMap = new Map();
      assert.strictEqual(resolveImageTaskAction(taskMap, 'https://example.com/img.jpg', true), 'create');
    });

    it('returns noop when task already exists and is already at the requested priority', () => {
      const taskMap = new Map([['https://example.com/img.jpg', { priority: TASK_PRIORITY.NORMAL, active: false }]]);
      assert.strictEqual(resolveImageTaskAction(taskMap, 'https://example.com/img.jpg', false), 'noop');
    });

    it('returns promote when urgent request finds an existing normal-priority task', () => {
      const taskMap = new Map([['https://example.com/img.jpg', { priority: TASK_PRIORITY.NORMAL, active: false }]]);
      assert.strictEqual(resolveImageTaskAction(taskMap, 'https://example.com/img.jpg', true), 'promote');
    });

    it('returns noop when urgent task already exists and is urgent — no double-promote', () => {
      const taskMap = new Map([['https://example.com/img.jpg', { priority: TASK_PRIORITY.URGENT, active: true }]]);
      assert.strictEqual(resolveImageTaskAction(taskMap, 'https://example.com/img.jpg', true), 'noop');
    });
  });

  describe('shouldCacheFetchResponse', () => {
    it('returns true when URL is in the latest retention set', () => {
      const retentionSet = new Set(['https://example.com/img.jpg']);
      assert.strictEqual(shouldCacheFetchResponse('https://example.com/img.jpg', retentionSet), true);
    });

    it('returns false when URL is no longer in the retention set — old generation response discarded', () => {
      const retentionSet = new Set(['https://example.com/other.jpg']);
      assert.strictEqual(shouldCacheFetchResponse('https://example.com/img.jpg', retentionSet), false);
    });

    it('returns false for missing inputs', () => {
      assert.strictEqual(shouldCacheFetchResponse(null, new Set()), false);
      assert.strictEqual(shouldCacheFetchResponse('https://example.com/img.jpg', null), false);
    });
  });
});
