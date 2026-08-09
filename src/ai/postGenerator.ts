/**
 * AI-модуль для генерации полноценных постов из идей.
 *
 * Принимает идею и текст поста конкурента, генерирует готовый пост
 * для канала Натальи Жирновой через GPT-4o-mini.
 * Retry логика живёт на уровне сервиса (src/services/post/postGenerationService.ts).
 */

import { openai, DEFAULT_MODEL } from '../core/lib/openai';
import { loadPrompt } from '../shared/utils/promptLoader';
import {
  POST_PROMPT_PATH,
  POST_MAX_TOKENS,
  POST_TEMPERATURE,
} from './postGenerator.config';
import type { GeneratePostInput } from '../shared/types/post.types';


export async function generatePost(input: GeneratePostInput): Promise<string> {
  const { idea, competitorPostText } = input;

  if (!idea.title || !idea.mainIdea || !idea.goal) {
    throw new Error('Incomplete idea data: title, mainIdea and goal are required');
  }
  
  const trimmedText = competitorPostText?.trim() ?? '';
  if (trimmedText.length === 0) {
    throw new Error('Cannot generate post from empty competitor text');
  }

  const systemPrompt = loadPrompt(POST_PROMPT_PATH);

  const userMessage = `<untrusted_source>
ИДЕЯ:
Заголовок: ${idea.title}
Основная идея: ${idea.mainIdea}
Цель: ${idea.goal}

ПОСТ КОНКУРЕНТА:
${trimmedText}
</untrusted_source>`;
  
  const response = await openai.chat.completions.create({
    model: DEFAULT_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    max_tokens: POST_MAX_TOKENS,
    temperature: POST_TEMPERATURE,
  });
  
  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('LLM returned empty response');
  }
  
  const trimmedPost = content.trim();
  if (trimmedPost.length === 0) {
    throw new Error('LLM returned empty post text');
  }
  
  return trimmedPost;
}
