export type DuplicateSource = 'idea' | 'nataliaPost' | 'transcriptPost';

/**
 * Результат поиска похожего контента через векторный поиск.
 */
export interface SimilarityMatch {
  readonly id: string;
  readonly similarity: number;
  readonly createdAt?: Date;
}

export interface BaseDuplicationResult {
  isDuplicate: boolean;
  maxSimilarity: number;
  source: DuplicateSource | null;
  matchedId: string | null;
}
