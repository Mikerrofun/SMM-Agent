import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getThreshold } from '../src/services/shared/thresholdResolver';

test('nataliaChannelPost против nataliaPost — порог 0.85', () => {
  assert.equal(getThreshold('nataliaChannelPost', 'nataliaPost'), 0.85);
});

test('nataliaChannelPost против своих постов — базовый порог 0.75', () => {
  assert.equal(getThreshold('nataliaChannelPost', 'nataliaChannelPost'), 0.75);
});

test('transcriptPost против nataliaPost — порог 0.75 (не изменён)', () => {
  assert.equal(getThreshold('transcriptPost', 'nataliaPost'), 0.75);
});

test('idea против nataliaChannelPost — порог 0.75 (не изменён)', () => {
  assert.equal(getThreshold('idea', 'nataliaChannelPost'), 0.75);
});

test('crossContent и sameType не изменены', () => {
  assert.equal(getThreshold('idea', 'transcriptPost'), 0.80);
  assert.equal(getThreshold('transcriptPost', 'idea'), 0.80);
  assert.equal(getThreshold('transcriptPost', 'transcriptPost'), 0.75);
  assert.equal(getThreshold('idea', 'idea'), 0.75);
});
