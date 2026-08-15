/**
 * Хендлер команды /transcript_post — запускает флоу генерации постов.
 */

import type { Context } from 'grammy';

/**
 * Map для отслеживания пользователей, ожидающих загрузки PDF.
 */
export const waitingForPdf = new Map<number, boolean>();

/**
 * Обработчик команды /transcript_post.
 * Сообщает пользователю, что бот ожидает PDF файл.
 */
export async function handleTranscriptCommand(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;

  if (!userId) {
    return;
  }

  waitingForPdf.set(userId, true);

  await ctx.reply(
    '📄 Отправь PDF файл с транскрипцией встречи с клиентом.\n\n' +
      'После обработки я сгенерирую 2 поста в стиле Натальи.'
  );
}
