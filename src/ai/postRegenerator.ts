/**
 * AI-модуль для перегенерации постов в стиле Натальи.
 *
 * Переписывает существующий пост, сохраняя основную идею (mainIdea),
 * но меняя стилистику, формулировки и структуру.
 * Может учитывать фидбек пользователя.
 *
 * Retry логика и обработка БД находятся на уровне service.
 */

import { openai, DEFAULT_MODEL } from '../core/lib/openai';
import { loadPrompt } from '../shared/utils/promptLoader';
import {
  REGENERATE_PROMPT_PATH,
  REGENERATE_MAX_TOKENS,
  REGENERATE_TEMPERATURE,
} from './postRegenerator.config';
import type { RegeneratePostInput } from './postRegenerator.types';


export async function regeneratePost(input: RegeneratePostInput): Promise<string> {
  const { currentText, mainIdea, feedback } = input;

  const trimmedText = currentText?.trim() ?? '';
  if (trimmedText.length === 0) {
    throw new Error('Cannot regenerate from empty text');
  }

  const trimmedMainIdea = mainIdea?.trim() ?? '';
  if (trimmedMainIdea.length === 0) {
    throw new Error('MainIdea cannot be empty');
  }

  let feedbackText = '';
  if (feedback) {
    const trimmedFeedback = feedback?.trim() ?? '';
    if (trimmedFeedback.length > 1000) {
      throw new Error('Feedback cannot exceed 1000 characters');
    }
    feedbackText = trimmedFeedback;
  }

  const systemPrompt = loadPrompt(REGENERATE_PROMPT_PATH);

  const userMessage = `<untrusted_source>
ИСХОДНЫЙ ПОСТ (который надо переписать):
${trimmedText}

MAIN IDEA (обязательно сохрани эту суть):
${trimmedMainIdea}

ФИДБЕК ПОЛЬЗОВАТЕЛЯ:
${feedbackText || 'Перепиши пост, сохраняя основную идею, но измени стилистику и формулировки'}
</untrusted_source>`;

  const response = await openai.chat.completions.create({
    model: DEFAULT_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    max_tokens: REGENERATE_MAX_TOKENS,
    temperature: REGENERATE_TEMPERATURE,
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
