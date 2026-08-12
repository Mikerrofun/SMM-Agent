import { resolve } from 'path';
import type { RetryConfig } from '../shared/utils/retry';

/**
 * Пока переиспользуем промпт генерации постов.
 * В будущем заменится на специализированный transcript-post.md.
 */
export const TRANSCRIPT_PROMPT_PATH = resolve(
  process.cwd(),
  'src/prompts/generate-post.md'
);

export const TRANSCRIPT_MAX_TOKENS = 2000;
export const TRANSCRIPT_TEMPERATURE = 0.7;

/** Максимальная длина транскрипции, отправляемой в LLM. */
export const TRANSCRIPT_MAX_INPUT_LENGTH = 8000;

/** Сколько символов берём с начала при обрезке длинной транскрипции. */
export const TRANSCRIPT_HEAD_LENGTH = 6000;

/** Сколько символов берём с конца при обрезке длинной транскрипции. */
export const TRANSCRIPT_TAIL_LENGTH = 2000;

export const TRANSCRIPT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  delayMs: 1000,
  backoffFactor: 2,
};
