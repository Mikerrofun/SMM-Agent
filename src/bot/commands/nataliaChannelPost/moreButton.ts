import type { Context } from 'grammy';
import { InlineKeyboard } from 'grammy';
import { getSentPosts } from '../../../repositories/nataliaChannelPostRepository';
import { generateAdditionalNataliaChannelPost } from '../../../services/nataliaChannelPost/nataliaChannelPostService';
import { CALLBACK_PREFIX } from './config';
import { sendSinglePost } from './renderer';

/**
 * Обработчик нажатия на кнопку "Найти ещё пост".
 * Генерирует один дополнительный пост из тем канала Натальи.
 */
export async function handleNataliaChannelMoreCallback(
  ctx: Context
): Promise<void> {
  try {
    const callbackData = ctx.callbackQuery?.data;

    if (!callbackData || !callbackData.startsWith(CALLBACK_PREFIX)) {
      await ctx.answerCallbackQuery({
        text: '❌ Неверные данные',
      });
      return;
    }

    await ctx.answerCallbackQuery({
      text: '⏳ Ищу уникальную тему...',
    });

    try {
      await ctx.editMessageReplyMarkup({ reply_markup: undefined });
    } catch (error) {
      console.error('[NataliaChannelPost] Failed to remove keyboard:', error);
    }

    const statusMessage = await ctx.reply(
      '⏳ Ищу уникальную тему в канале...'
    );

    const result = await generateAdditionalNataliaChannelPost();

    try {
      await ctx.api.deleteMessage(ctx.chat!.id, statusMessage.message_id);
    } catch (deleteError) {
      console.error(
        '[NataliaChannelPost] Failed to delete status message:',
        deleteError
      );
    }

    if (!result.success) {
      if (result.reason === 'no_unique_topics') {
        await ctx.reply(
          '💭 Больше уникальных тем для канала не найдено.\n\n' +
            'Все идеи пересекаются с уже опубликованным контентом.'
        );
      } else {
        const keyboard = new InlineKeyboard().text(
          '📝 Найти ещё пост',
          CALLBACK_PREFIX
        );

        await ctx.reply(
          `❌ Произошла ошибка: ${result.error ?? 'Неизвестная ошибка'}\n\n` +
            'Попробуй ещё раз.',
          { reply_markup: keyboard }
        );
      }
      return;
    }

    const sentPosts = await getSentPosts();
    const postNumber = sentPosts.length;

    await sendSinglePost(ctx, result.post!, postNumber);

    const keyboard = new InlineKeyboard().text(
      '📝 Найти ещё пост',
      CALLBACK_PREFIX
    );

    await ctx.reply(`✅ Найден ещё один пост для канала!`, {
      reply_markup: keyboard,
    });

    console.log('[NataliaChannelPost] Additional post sent', {
      postId: result.post!.id,
    });
  } catch (error) {
    console.error('[NataliaChannelPost] Callback handler failed', {
      error: error instanceof Error ? error.message : String(error),
    });

    try {
      await ctx.reply(
        '❌ Произошла ошибка при генерации поста. Попробуй позже.'
      );
    } catch (replyError) {
      console.error(
        '[NataliaChannelPost] Failed to send error message:',
        replyError
      );
    }
  }
}
