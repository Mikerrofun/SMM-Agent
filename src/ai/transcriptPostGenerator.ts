/**
 * AI-модуль генерации постов из транскрипций встреч с клиентами.
 *
 * Retry живёт на уровне сервиса (src/services/transcript/transcriptProcessingService.ts).
 */

import { openai, DEFAULT_MODEL } from '../core/lib/openai';
import { loadPrompt } from '../shared/utils/promptLoader';
import {
  TRANSCRIPT_PROMPT_PATH,
  TRANSCRIPT_MAX_TOKENS,
  TRANSCRIPT_TEMPERATURE,
  TRANSCRIPT_MAX_INPUT_LENGTH,
  TRANSCRIPT_HEAD_LENGTH,
  TRANSCRIPT_TAIL_LENGTH,
} from './transcriptPostGenerator.config';

/**
 * Обрезает слишком длинную транскрипцию: начало + конец,
 * чтобы сохранить и контекст знакомства, и итоги встречи.
 */
export function truncateTranscript(text: string): string {
  if (text.length <= TRANSCRIPT_MAX_INPUT_LENGTH) {
    return text;
  }

  const head = text.slice(0, TRANSCRIPT_HEAD_LENGTH);
  const tail = text.slice(-TRANSCRIPT_TAIL_LENGTH);

  return `${head}\n\n[...фрагмент транскрипции пропущен...]\n\n${tail}`;
}

/**
 * Генерирует пост из текста транскрипции.
 *
 * @param transcriptText — текст транскрипции встречи
 * @param excludeMainIdeas — главные мысли уже сгенерированных постов, чтобы не повторяться
 * @returns текст поста
 */
export async function generatePostFromTranscript(
  transcriptText: string,
  excludeMainIdeas: string[] = []
): Promise<string> {
  const trimmed = transcriptText?.trim() ?? '';

  if (trimmed.length === 0) {
    throw new Error('Cannot generate post from empty transcript');
  }

  const preparedText = truncateTranscript(trimmed);
  const systemPrompt = loadPrompt(TRANSCRIPT_PROMPT_PATH);

  const avoidBlock =
    excludeMainIdeas.length > 0
      ? `\nУЖЕ РАСКРЫТЫЕ ТЕМЫ (не повторяй их, выбери другой инсайт):\n${excludeMainIdeas
          .map((idea, index) => `${index + 1}. ${idea}`)
          .join('\n')}\n`
      : '';

  const userMessage = `<untrusted_source>
ТРАНСКРИПЦИЯ ВСТРЕЧИ С КЛИЕНТОМ:

${preparedText}
${avoidBlock}
ЗАДАЧА:
Извлеки из транскрипции ключевой инсайт или проблему клиента.
Создай пост для Telegram-канала Натальи, раскрывающий эту тему.
</untrusted_source>`;

  const response = await openai.chat.completions.create({
    model: DEFAULT_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    max_tokens: TRANSCRIPT_MAX_TOKENS,
    temperature: TRANSCRIPT_TEMPERATURE,
  });

  const content = response.choices[0]?.message?.content?.trim() ?? '';

  if (content.length === 0) {
    throw new Error('LLM returned empty post text');
  }

  return content;
}
