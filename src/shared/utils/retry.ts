import { sleep } from "./sleep";

export interface RetryConfig {
  maxAttempts: number;
  delayMs: number;
  /** Множитель экспоненциальной задержки между попытками (1 = линейная). */
  backoffFactor?: number;
}

/**
 * Выполняет асинхронную операцию с повторными попытками.
 * После исчерпания попыток пробрасывает последнюю ошибку.
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  config: RetryConfig
): Promise<T> {
  const { maxAttempts, delayMs, backoffFactor = 1 } = config;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        await sleep(delayMs * Math.pow(backoffFactor, attempt - 1));
      }
    }
  }

  throw lastError;
}
