import type { RetryConfig } from '../../shared/utils/retry';

/** Сколько постов генерируем из одной транскрипции. */
export const POSTS_PER_TRANSCRIPT = 2;

/** Сколько попыток даём на один пост, чтобы получить уникальный. */
export const MAX_ATTEMPTS_PER_POST = 3;

/** Retry для отдельных AI-вызовов внутри попытки. */
export const AI_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  delayMs: 1000,
  backoffFactor: 2,
};
