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