import type { RetryConfig } from '../../shared/utils/retry';

/** Сколько постов генерируется за один вызов команды /natalia_channel_post. */
export const POSTS_PER_RUN = 2;

export const MAX_ATTEMPTS_PER_POST = 3;

export const AI_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  delayMs: 1000,
  backoffFactor: 2,
};
