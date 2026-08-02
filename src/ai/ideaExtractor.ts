/**
 * AI-модуль для генерации идей из постов конкурентов.
 *
 * Принимает текст поста конкурента, генерирует структурированную идею
 * для канала Натальи Жирновой через GPT-4o с Structured Outputs.
 * Retry и batch-обработка живут на уровне сервиса (src/services/idea/ideaProcessor.ts).
 */

import { openai, DEFAULT_MODEL } from '../core/lib/openai';
import { GeneratedIdeaSchema, IdeaJsonSchema } from '../schemas/idea.schema';
import { loadPrompt } from '../shared/utils/promptLoader';
import {
  IDEA_PROMPT_PATH,
  IDEA_MAX_TOKENS,
  IDEA_TEMPERATURE,
} from './ideaExtractor.config';
import type { GeneratedIdea } from '../types/idea.types';

/**
 * Генерирует структурированную идею из текста поста конкурента через LLM.
 *
 * @param postText — текст поста конкурента
 * @returns структурированная идея { title, mainIdea, goal }
 * @throws пробрасывает ошибку наверх для retry на уровне сервиса
 */
export async function extractIdea(postText: string): Promise<GeneratedIdea> {
  const trimmed = postText?.trim() ?? '';
  
  if (trimmed.length === 0) {
    throw new Error('Cannot extract idea from empty text');
  }
  
  const systemPrompt = loadPrompt(IDEA_PROMPT_PATH);
  
  // Оборачиваем текст конкурента в <untrusted_source> для безопасности
  const userMessage = `<untrusted_source>\n${trimmed}\n</untrusted_source>`;
  
  const response = await openai.chat.completions.create({
    model: DEFAULT_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    max_tokens: IDEA_MAX_TOKENS,
    temperature: IDEA_TEMPERATURE,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'idea_extraction',
        strict: true,
        schema: IdeaJsonSchema,
      },
    },
  });
  
  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('LLM returned empty response');
  }
  
  const parsed = JSON.parse(content);
  const validated = GeneratedIdeaSchema.parse(parsed);
  
  return validated;
}
