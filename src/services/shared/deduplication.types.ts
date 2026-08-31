/**
 * Общие типы для системы дедупликации.
 * Используются в сервисах дедупликации Ideas, TranscriptPosts и NataliaPost.
 */

/**
 * Тип источника контента для дедупликации.
 */
export type DuplicateSource = 'idea' | 'nataliaPost' | 'transcriptPost';

/**
 * Результат поиска похожего контента через векторный поиск.
 */
export interface SimilarityMatch {
  readonly id: string;
  readonly similarity: number;
  readonly createdAt?: Date;
}

/**
 * Базовый интерфейс результата дедупликации.
 */
export interface BaseDuplicationResult {
  isDuplicate: boolean;
  maxSimilarity: number;
  source: DuplicateSource | null;
  matchedId: string | null;
}
