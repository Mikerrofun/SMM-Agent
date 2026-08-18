import { resolve } from 'path';
import type { RetryConfig } from '../shared/utils/retry';

export const REGENERATE_PROMPT_PATH = resolve(
  process.cwd(),
  'src/prompts/regenerate-post.md'
);


export const REGENERATE_MAX_TOKENS = 2000;
export const REGENERATE_TEMPERATURE = 0.7;


export const REGENERATE_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  delayMs: 1000,
  backoffFactor: 2,
};
