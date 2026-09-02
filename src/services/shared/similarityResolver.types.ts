import type { SimilarityMatch, DuplicateSource } from './deduplication.types';

export interface SimilaritySource<TSource extends DuplicateSource = DuplicateSource> {
  source: TSource;
  matches: SimilarityMatch[];
}

export interface ResolvedSimilarity<TSource extends DuplicateSource = DuplicateSource> {
  maxSimilarity: number;
  source: TSource | null;
  matchedId: string | null;
}