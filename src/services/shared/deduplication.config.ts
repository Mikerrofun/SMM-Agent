import type { RetryConfig } from '../../shared/utils/retry';

/**
 * Единая конфигурация порогов similarity для дедупликации.
 * 
 * - nataliaPost: порог для проверки против постов Натальи
 * - crossContent: порог для проверки Ideas ↔ TranscriptPosts
 * - sameType: порог для проверки внутри одного типа (Idea vs Idea, TranscriptPost vs TranscriptPost)
 */
export const DEDUPLICATION_THRESHOLDS = {
  nataliaPost: 0.75,
  crossContent: 0.82,
  sameType: 0.75,
} as const;

/**
 * Конфигурация retry для операций дедупликации.
 */
export const DEDUPLICATION_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  delayMs: 1000,
  backoffFactor: 2,
};
