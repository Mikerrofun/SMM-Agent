import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isNataliaRelevanceRejected,
  NATALIA_RELEVANCE_REASON,
} from '../src/services/shared/relevanceFilter';

test('nataliaSimilarity < 0.5 при отсутствии дубля → отбраковка natalia_relevance', () => {
  assert.equal(isNataliaRelevanceRejected(0.49, false), true);
  assert.equal(NATALIA_RELEVANCE_REASON, 'natalia_relevance');
});

test('nataliaSimilarity >= 0.5 и не дубль → проходит', () => {
  assert.equal(isNataliaRelevanceRejected(0.5, false), false);
  assert.equal(isNataliaRelevanceRejected(0.74, false), false);
});

test('дубль не проходит через фильтр релевантности (он уже дубль)', () => {
  assert.equal(isNataliaRelevanceRejected(0.3, true), false);
});

test('граничный случай: 0 → отбраковка, 1 → проходит', () => {
  assert.equal(isNataliaRelevanceRejected(0, false), true);
  assert.equal(isNataliaRelevanceRejected(1, false), false);
});
