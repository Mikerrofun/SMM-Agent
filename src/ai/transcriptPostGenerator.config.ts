import { resolve } from 'path';
import type { RetryConfig } from '../shared/utils/retry';

export const TRANSCRIPT_PROMPT_PATH = resolve(
  process.cwd(),
  'src/prompts/generate-transcript-post.md'
);

export const TRANSCRIPT_MAX_TOKENS = 2000;
export const TRANSCRIPT_TEMPERATURE = 0.7;

export const TRANSCRIPT_MAX_INPUT_LENGTH = 16000;

/** Сколько символов берём с начала при обрезке длинной транскрипции. */
export const TRANSCRIPT_HEAD_LENGTH = 12000
export const  TRANSCRIPT_TAIL_LENGTH = 4000

export const TRANSCRIPT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  delayMs: 1000,
  backoffFactor: 2,
};
