import type { SimilaritySource, ResolvedSimilarity } from './similarityResolver.types';
import type { DuplicateSource } from './deduplication.types';
import { getThreshold } from './thresholdResolver';


export function resolveBestMatch(
  targetSource: DuplicateSource,
  sources: Array<SimilaritySource>
): ResolvedSimilarity {
  let maxSimilarity = 0;
  let source: DuplicateSource | null = null;
  let matchedId: string | null = null;

  for (const candidate of sources) {
    const best = candidate.matches[0];

    if (!best) {
      continue;
    }

    if (best.similarity > maxSimilarity) {
      maxSimilarity = best.similarity;
    }

    const threshold = getThreshold(targetSource, candidate.source);

    if (best.similarity >= threshold && best.similarity > 0) {
      source = candidate.source;
      matchedId = best.id;
    }
  }

  return { maxSimilarity, source, matchedId };
}

