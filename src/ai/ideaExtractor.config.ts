import { resolve } from 'path';


export const IDEA_PROMPT_PATH = resolve(
  process.cwd(),
  'src/prompts/extract-idea-competitor-post.md'
);

export const IDEA_MAX_TOKENS = 300;
export const IDEA_TEMPERATURE = 0.7;
