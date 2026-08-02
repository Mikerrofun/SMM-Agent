import type { RetryConfig } from '../../shared/utils/retry';

/**
 * Retry конфигурация для генерации идей через AI.
 * Экспоненциальный backoff помогает переждать временные ошибки API.
 */
export const IDEA_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  delayMs: 1000,
  backoffFactor: 2,
};

/**
 * Rate limiting для OpenAI API.
 * GPT-4o-mini Tier 1: 500 req/min, но консервативно ограничиваем
 * до 30 req/min для стабильности и избежания 429 ошибок.
 */
export const IDEA_RATE_LIMIT = {
  requestsPerMinute: 30,
  concurrency: 5, // параллельных worker'ов
} as const;
