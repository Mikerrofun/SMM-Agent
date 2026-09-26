/**
 * Хендлер команды /natalia_channel_post — запускает флоу генерации постов
 * из главных идей канала Натальи
 */

import { Context } from 'grammy';
import { processNataliaChannelPosts } from '../../../services/nataliaChannelPost';
import { finishAndShowButton } from './renderer';
import type { StatusMessageId } from '../../../shared/types/nataliaChannelPost.types';
const runningForUser = new Map<number, boolean>();

export async function handleNataliaChannelPostCommand(
  ctx: Context
): Promise<void> {
  const userId = ctx.from?.id;

  if (!userId) {
    return;
  }

  if (runningForUser.get(userId)) {
    await ctx.reply('⏳ Уже идёт генерация. Дождись завершения.');
    return;
  }

  runningForUser.set(userId, true);

  let statusMessageId: StatusMessageId;

  try {
    const statusMessage = await ctx.reply(
      '⏳ Генерирую посты из тем канала...'
    );
    statusMessageId = statusMessage.message_id;
    

    const result = await processNataliaChannelPosts();

    if (statusMessageId && ctx.chat) {
      try {
        await ctx.api.deleteMessage(ctx.chat.id, statusMessageId);
      } catch (deleteError) {
        console.error(
          '[NataliaChannelPost] Failed to delete status message:',
          deleteError
        );
      }
      statusMessageId = undefined;
    }

    if (result.posts.length === 0) {
      await ctx.reply(
        '❌ Не удалось сгенерировать посты: все попытки пересеклись с уже опубликованным контентом. Попробуй позже.'
      );
      return;
    }
    
    await finishAndShowButton(ctx, result.posts);
  } catch (error) {
    console.error('[NataliaChannelPost] Processing failed', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });

    if (statusMessageId && ctx.chat) {
      try {
        await ctx.api.deleteMessage(ctx.chat.id, statusMessageId);
      } catch {
        // статус мог быть уже удалён — игнорируем
      }
    }

    try {
      await ctx.reply(
        '❌ Произошла ошибка при генерации постов. Попробуй еще раз.'
      );
    } catch (replyError) {
      console.error(
        '[NataliaChannelPost] Failed to send error message:',
        replyError
      );
    }
  } finally {
    runningForUser.delete(userId);
  }
}
