import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveBestMatch } from '../src/services/shared/similarityResolver';

test('nataliaSimilarity берётся как max из двух natalia-источников', () => {
  const result = resolveBestMatch('transcriptPost', [
    { source: 'nataliaPost', matches: [{ id: 'np-1', similarity: 0.62 }] },
    { source: 'nataliaChannelPost', matches: [{ id: 'ncp-1', similarity: 0.71 }] },
    { source: 'idea', matches: [{ id: 'idea-1', similarity: 0.55 }] },
  ]);

  assert.equal(result.nataliaSimilarity, 0.71);
});

test('nataliaSimilarity учитывает nataliaPost, если он выше', () => {
  const result = resolveBestMatch('idea', [
    { source: 'nataliaPost', matches: [{ id: 'np-1', similarity: 0.68 }] },
    { source: 'nataliaChannelPost', matches: [{ id: 'ncp-1', similarity: 0.4 }] },
  ]);

  assert.equal(result.nataliaSimilarity, 0.68);
});

test('maxSimilarity не сломан: считается по всем источникам', () => {
  const result = resolveBestMatch('idea', [
    { source: 'idea', matches: [{ id: 'idea-1', similarity: 0.9 }] },
    { source: 'nataliaPost', matches: [{ id: 'np-1', similarity: 0.6 }] },
    { source: 'transcriptPost', matches: [{ id: 'tp-1', similarity: 0.7 }] },
  ]);

  assert.equal(result.maxSimilarity, 0.9);
  assert.equal(result.source, 'idea');
  assert.equal(result.matchedId, 'idea-1');
});

test('дубль по nataliaChannelPost определяется с порогом 0.75', () => {
  const result = resolveBestMatch('idea', [
    { source: 'nataliaChannelPost', matches: [{ id: 'ncp-1', similarity: 0.8 }] },
  ]);

  assert.equal(result.source, 'nataliaChannelPost');
  assert.equal(result.matchedId, 'ncp-1');
});

test('без совпадений nataliaSimilarity = 0, source = null', () => {
  const result = resolveBestMatch('idea', [
    { source: 'nataliaPost', matches: [] },
    { source: 'nataliaChannelPost', matches: [] },
  ]);

  assert.equal(result.nataliaSimilarity, 0);
  assert.equal(result.source, null);
  assert.equal(result.matchedId, null);
});
