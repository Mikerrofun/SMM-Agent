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
  nataliaChannelPost: 0.75,
  crossContent: 0.80,
  sameType: 0.75,
  // Пороги для natalia_channel_post: пост генерируется из карты mainIdea канала,
  // поэтому тема наследуется из источника и схожесть с ним изначально выше
  nataliaChannelPostVsNataliaPost: 0.85,
  nataliaChannelPostVsSelf: 0.85,
} as const;

/**
 * Минимальная допустимая схожесть с постами канала Натальи.
 * Контент, который не дубль, но схожее этого порога, отбраковывается
 * с причиной 'natalia_relevance' (слишком близко к уже опубликованному).
 */
export const MIN_NATALIA_SIMILARITY = 0.5;


export const DEDUPLICATION_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  delayMs: 1000,
  backoffFactor: 2,
};
