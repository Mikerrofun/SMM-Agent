import type { SimilarityMatch } from '../idea/deduplication.types';

export interface SimilaritySource<TSource extends string> {
  source: TSource;
  matches: SimilarityMatch[];
}

export interface ResolvedSimilarity<TSource extends string> {
  maxSimilarity: number;
  source: TSource | null;
  matchedId: string | null;
}

// matches отсортированы по similarity DESC, поэтому сравниваем первый элемент
export function resolveBestMatch<TSource extends string>(
  sources: Array<SimilaritySource<TSource>>
): ResolvedSimilarity<TSource> {
  let maxSimilarity = 0;
  let source: TSource | null = null;
  let matchedId: string | null = null;

  for (const candidate of sources) {
    const best = candidate.matches[0];

    if (best && best.similarity > maxSimilarity) {
      maxSimilarity = best.similarity;
      source = candidate.source;
      matchedId = best.id;
    }
  }

  return { maxSimilarity, source, matchedId };
}
