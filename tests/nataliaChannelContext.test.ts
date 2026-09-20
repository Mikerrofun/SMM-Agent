import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNataliaChannelContext } from '../src/services/shared/postGeneration/nataliaChannelContext';

test('пустой список → пустая строка', () => {
  assert.equal(buildNataliaChannelContext([]), '');
});

test('обычный список → нумерованный список (формат avoidBlock)', () => {
  const result = buildNataliaChannelContext([
    'Делегирование начинается с доверия',
    'Штаб владельца — контур координации',
  ]);

  assert.equal(
    result,
    '1. Делегирование начинается с доверия\n2. Штаб владельца — контур координации'
  );
});

test('одна идея → одна строка без переноса', () => {
  assert.equal(buildNataliaChannelContext(['Одна тема']), '1. Одна тема');
});
