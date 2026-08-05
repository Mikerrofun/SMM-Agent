import type { RetryConfig } from '../../shared/utils/retry';

export const SIMILARITY_THRESHOLD = 0.85;

export const DEDUPLICATION_STRATEGY = 'first' as const;

export const DEDUPLICATION_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  delayMs: 1000,
  backoffFactor: 2,
};
