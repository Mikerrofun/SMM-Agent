import { resolve } from 'path';
import type { RetryConfig } from '../shared/utils/retry';

export const POST_PROMPT_PATH = resolve(
  process.cwd(),
  'src/prompts/generate-post.md'
);
export const POST_MAX_TOKENS = 2000;
export const POST_TEMPERATURE = 0.7;

export const POST_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  delayMs: 1000,
  backoffFactor: 2,
};
