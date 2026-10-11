import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  normalizeTriviaId,
  shouldResetTriviaState,
  canAdmitTriviaResult,
  createInitialTriviaState,
  isValidTriviaState
} from '../src/helpers/trivia.js';

describe('Trivia helpers', () => {
  describe('normalizeTriviaId', () => {
    it('rewrites date segment to targetIsoDate', () => {
      const normalized = normalizeTriviaId('HPQuiz_20260720_SantaCatalina', '20260728');
      assert.strictEqual(normalized, 'HPQuiz_20260728_SantaCatalina');
    });

    it('preserves the slug portion', () => {
      const normalized = normalizeTriviaId('HPQuiz_20260719_Artemis', '20260728');
      assert.strictEqual(normalized, 'HPQuiz_20260728_Artemis');
    });

    it('returns null for malformed trivia IDs', () => {
      assert.strictEqual(normalizeTriviaId('InvalidFormat', '20260728'), null);
      assert.strictEqual(normalizeTriviaId('HPQuiz_notadate_test', '20260728'), null);
      assert.strictEqual(normalizeTriviaId('HPQuiz_20260720_Foo_20260810', '20260728'), null);
      assert.strictEqual(normalizeTriviaId('HPQuiz_20260720_Foo/../x', '20260728'), null);
      assert.strictEqual(normalizeTriviaId('HPQuiz_20260720_Foo%22', '20260728'), null);
      assert.strictEqual(normalizeTriviaId('', '20260728'), null);
    });

    it('returns null for non-string input', () => {
      assert.strictEqual(normalizeTriviaId(null, '20260728'), null);
      assert.strictEqual(normalizeTriviaId(undefined, '20260728'), null);
    });
  });

  describe('shouldResetTriviaState', () => {
    it('returns true when triviaId changes', () => {
      assert.strictEqual(
        shouldResetTriviaState('HPQuiz_20260728_test1', 'HPQuiz_20260728_test2'),
        true
      );
    });

    it('returns false when triviaId unchanged', () => {
      assert.strictEqual(
        shouldResetTriviaState('HPQuiz_20260728_test', 'HPQuiz_20260728_test'),
        false
      );
    });
  });

  describe('canAdmitTriviaResult', () => {
    it('admits result when triviaId matches', () => {
      const entry = { triviaId: 'HPQuiz_20260728_test' };
      assert.strictEqual(canAdmitTriviaResult(entry, 'HPQuiz_20260728_test'), true);
    });

    it('rejects result when triviaId differs', () => {
      const entry = { triviaId: 'HPQuiz_20260728_test1' };
      assert.strictEqual(canAdmitTriviaResult(entry, 'HPQuiz_20260728_test2'), false);
    });

    it('rejects result with missing data', () => {
      assert.strictEqual(canAdmitTriviaResult(null, 'HPQuiz_20260728_test'), false);
      assert.strictEqual(canAdmitTriviaResult({ triviaId: 'test' }, null), false);
    });
  });

  describe('createInitialTriviaState', () => {
    it('creates missing state with zero retry fields', () => {
      const state = createInitialTriviaState();
      assert.strictEqual(state.triviaState, 'missing');
      assert.strictEqual(state.triviaAttemptedAt, 0);
      assert.strictEqual(state.triviaNextRetryAt, 0);
      assert.strictEqual(state.triviaRetryLevel, 0);
    });
  });

  describe('isValidTriviaState', () => {
    it('accepts missing and complete states', () => {
      assert.strictEqual(isValidTriviaState('missing'), true);
      assert.strictEqual(isValidTriviaState('complete'), true);
    });

    it('rejects pending state', () => {
      assert.strictEqual(isValidTriviaState('pending'), false);
    });

    it('rejects invalid states', () => {
      assert.strictEqual(isValidTriviaState('invalid'), false);
      assert.strictEqual(isValidTriviaState(''), false);
    });
  });
});
