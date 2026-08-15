import type { Context } from 'grammy';
import { InlineKeyboard } from 'grammy';
import { getSentPosts } from '../../../repositories/transcriptPostRepository';
import { generateAdditionalPost } from '../../../services/transcript/transcriptProcessingService';
import { CALLBACK_PREFIX } from './config';
import { sendSinglePost } from './renderer';

/**
 * Обработчик нажатия на кнопку "Найти ещё пост".
 * Генерирует один дополнительный пост из той же транскрипции.
 */
export async function handleTranscriptMoreCallback(
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

    const transcriptId = callbackData.replace(CALLBACK_PREFIX, '');

    await ctx.answerCallbackQuery({
      text: '⏳ Ищу уникальную тему...',
    });

    try {
      await ctx.editMessageReplyMarkup({ reply_markup: undefined });
    } catch (error) {
      console.error('[TranscriptPost] Failed to remove keyboard:', error);
    }

    const statusMessage = await ctx.reply('⏳ Ищу уникальную тему в транскрипции...');

    const result = await generateAdditionalPost(transcriptId);

    try {
      await ctx.api.deleteMessage(ctx.chat!.id, statusMessage.message_id);
    } catch (deleteError) {
      console.error('[TranscriptPost] Failed to delete status message:', deleteError);
    }

    if (!result.success) {
      if (result.reason === 'no_unique_topics') {
        await ctx.reply(
          '💭 Больше уникальных тем в этой встрече не найдено.\n\n' +
            'Все инсайты из транскрипции уже использованы.'
        );
      } else {
        const keyboard = new InlineKeyboard().text(
          '📝 Найти ещё пост',
          `${CALLBACK_PREFIX}${transcriptId}`
        );

        await ctx.reply(
          `❌ Произошла ошибка: ${result.error ?? 'Неизвестная ошибка'}\n\n` +
            'Попробуй ещё раз.',
          { reply_markup: keyboard }
        );
      }
      return;
    }

    const sentPosts = await getSentPosts(transcriptId);
    const postNumber = sentPosts.length;

    await sendSinglePost(ctx, result.post!, postNumber);

    const keyboard = new InlineKeyboard().text(
      '📝 Найти ещё пост',
      `${CALLBACK_PREFIX}${transcriptId}`
    );

    await ctx.reply(
      `✅ Найден ещё один пост из этой встречи!`,
      { reply_markup: keyboard }
    );

    console.log('[TranscriptPost] Additional post sent', {
      transcriptId,
      postId: result.post!.id,
    });
  } catch (error) {
    console.error('[TranscriptPost] Callback handler failed', {
      error: error instanceof Error ? error.message : String(error),
    });

    try {
      await ctx.reply(
        '❌ Произошла ошибка при генерации поста. Попробуй позже.'
      );
    } catch (replyError) {
      console.error('[TranscriptPost] Failed to send error message:', replyError);
    }
  }
}
