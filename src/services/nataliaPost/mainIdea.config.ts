import type { RetryConfig } from "../../shared/utils/retry";

/**
 * Retry для извлечения mainIdea.
 * Экспоненциальный backoff помогает переждать 429 (rate limit).
 */
export const MAIN_IDEA_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 4,
  delayMs: 5000,
  backoffFactor: 2,
};


export const MAIN_IDEA_RATE_LIMIT = {
  requestsPerMinute: 28,
  concurrency: 5,
} as const;
