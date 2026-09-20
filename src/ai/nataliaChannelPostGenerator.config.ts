import { resolve } from 'path';

export const NATALIA_CHANNEL_PROMPT_PATH = resolve(
  process.cwd(),
  'src/prompts/generate-natalia-channel-post.md'
);

export const NATALIA_CHANNEL_MAX_TOKENS = 2000;
export const NATALIA_CHANNEL_TEMPERATURE = 0.7;
