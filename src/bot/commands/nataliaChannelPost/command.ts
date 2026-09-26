/**
 * Хендлер команды /natalia_channel_post — запускает флоу генерации постов
 * из главных идей канала Натальи
 */

import { Context } from 'grammy';
import { processNataliaChannelPosts } from '../../../services/nataliaChannelPost';
import { finishAndShowButton } from './renderer';
import { commandManager } from '../../../shared/utils/CommandManager/CommandManager';
import { CommandCancelledError } from '../../../shared/utils/CommandManager/CommandManager.errors';

export async function handleNataliaChannelPostCommand(
  ctx: Context
): Promise<void> {
  await commandManager.execute(
    ctx,
    'natalia_channel_post',
    {
      statusText: '⏳ Генерирую посты из тем канала...',
      // Команда сама удаляет статус-сообщение перед выводом постов —
      // execute не должен редактировать удалённое сообщение
    },
    async (_ctx, { statusMessage }) => {
      try {
        const result = await processNataliaChannelPosts();

        if (statusMessage && ctx.chat) {
          try {
            await ctx.api.deleteMessage(ctx.chat.id, statusMessage.message_id);
          } catch (deleteError) {
            console.error(
              '[NataliaChannelPost] Failed to delete status message:',
              deleteError
            );
          }
        }

        if (result.posts.length === 0) {
          await ctx.reply(
            '❌ Не удалось сгенерировать посты: все попытки пересеклись с уже опубликованным контентом. Попробуй позже.'
          );
          return;
        }

        await finishAndShowButton(ctx, result.posts);
      } catch (error) {
        // Отмену обрабатывает execute — прокидываем дальше
        if (error instanceof CommandCancelledError) {
          throw error;
        }

        console.error('[NataliaChannelPost] Processing failed', {
          error: error instanceof Error ? error.message : String(error),
        });

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
      }
    }
  );
}
