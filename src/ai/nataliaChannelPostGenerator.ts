/**
 * AI-модуль генерации постов из главных идей канала Натальи
 * (команда /natalia_channel_post).
 *
 * Паттерн скопирован с transcriptPostGenerator.ts.
 * Retry живёт на уровне сервиса (src/services/nataliaChannelPost/).
 *
 * Структура промптов:
 *  - system: базовый промпт с задачей генерации постов из идей канала
 *  - user message:
 *    • статичная часть: главные идеи канала (в <untrusted_source>)
 *    • динамический блок «УЖЕ РАСКРЫТЫЕ ТЕМЫ» — СТРОГО в конце user message
 *      (сохранение prefix-кэша: статичный префикс не меняется между вызовами)
 */

import { openai, DEFAULT_MODEL } from '../core/lib/openai';
import { loadPrompt } from '../shared/utils/promptLoader';
import {
  NATALIA_CHANNEL_PROMPT_PATH,
  NATALIA_CHANNEL_MAX_TOKENS,
  NATALIA_CHANNEL_TEMPERATURE,
} from './nataliaChannelPostGenerator.config';

export async function generateNataliaChannelPost(
  channelContext: string,
  excludeMainIdeas: string[] = []
): Promise<string> {
  const trimmedContext = channelContext?.trim() ?? '';

  if (trimmedContext.length === 0) {
    throw new Error('Cannot generate post from empty channel context');
  }

  const systemPrompt = loadPrompt(NATALIA_CHANNEL_PROMPT_PATH);

  const staticPart = `<untrusted_source>
ГЛАВНЫЕ ИДЕИ КАНАЛА НАТАЛЬИ:

${trimmedContext}
</untrusted_source>`;

  // Динамический блок — строго в конце user message (prefix-кэш)
  const avoidBlock =
    excludeMainIdeas.length > 0
      ? `\nУЖЕ РАСКРЫТЫЕ ТЕМЫ (не повторяй их, выбери другую тему или новый ракурс):\n${excludeMainIdeas
          .map((idea, index) => `${index + 1}. ${idea}`)
          .join('\n')}\n`
      : '';

  const userMessage = `${staticPart}${avoidBlock}`;

  const response = await openai.chat.completions.create({
    model: DEFAULT_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    max_tokens: NATALIA_CHANNEL_MAX_TOKENS,
    temperature: NATALIA_CHANNEL_TEMPERATURE,
  });

  const content = response.choices[0]?.message?.content?.trim() ?? '';

  if (content.length === 0) {
    throw new Error('LLM returned empty post text');
  }

  return content;
}
