import type {
  DuplicateSource,
  SimilarityMatch,
  BaseDuplicationResult,
} from '../shared/deduplication.types';

// Экспорт общих типов для обратной совместимости
export type { DuplicateSource, SimilarityMatch };

/**
 * Результат проверки дедупликации для TranscriptPost.
 */
export interface DuplicationResult extends BaseDuplicationResult {}

/**
 * Результат проверки с embedding.
 */
export interface EmbeddingCheckResult extends BaseDuplicationResult {
  embedding: number[];
}

