import type { SimilaritySource, ResolvedSimilarity } from './similarityResolver.types';
import type { DuplicateSource } from './deduplication.types';
import { getThreshold } from './thresholdResolver';

/** Источники, схожесть с которыми трактуются как «похожесть на канал Натальи». */
const NATALIA_SOURCES: ReadonlySet<DuplicateSource> = new Set([
  'nataliaPost',
  'nataliaChannelPost',
]);

export function resolveBestMatch(
  targetSource: DuplicateSource,
  sources: Array<SimilaritySource>
): ResolvedSimilarity {
  let maxSimilarity = 0;
  let source: DuplicateSource | null = null;
  let matchedId: string | null = null;
  let nataliaSimilarity = 0;

  for (const candidate of sources) {
    const best = candidate.matches[0];

    if (!best) {
      continue;
    }

    if (best.similarity > maxSimilarity) {
      maxSimilarity = best.similarity;
    }

    // matches[0] — максимум, т.к. репозитории сортируют по similarity DESC
    if (NATALIA_SOURCES.has(candidate.source) && best.similarity > nataliaSimilarity) {
      nataliaSimilarity = best.similarity;
    }

    const threshold = getThreshold(targetSource, candidate.source);

    if (best.similarity >= threshold && best.similarity > 0) {
      source = candidate.source;
      matchedId = best.id;
    }
  }

  return { maxSimilarity, source, matchedId, nataliaSimilarity };
}
