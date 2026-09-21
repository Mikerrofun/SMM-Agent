/**
 * Отправка постов канала Натальи в Telegram.
 */

import type { Context } from 'grammy';
import { InlineKeyboard } from 'grammy';
import { sleep } from '../../../shared/utils/sleep';
import type { NataliaChannelPostData } from '../../../shared/types/nataliaChannelPost.types';
import { POSTS_PER_RUN } from '../../../services/nataliaChannelPost/nataliaChannelPost.config';
import { CALLBACK_PREFIX, DELAY_BETWEEN_POSTS_MS } from './config';
import { pluralizePost } from '../transcriptPost/utils';
import { validateCallbackData } from '../../../shared/utils/callbackDataValidator';

export async function sendSinglePost(
  ctx: Context,
  post: NataliaChannelPostData,
  postNumber: number
): Promise<void> {
  try {
    if (!post.id) {
      throw new Error('[NataliaChannelPost] Post ID is missing');
    }

    const regenerateCallback = `regenerate_natalia_channel_post:${post.id}`;
    const feedbackCallback = `regenerate_natalia_channel_post_feedback:${post.id}`;

    // Валидируем callback_data перед созданием клавиатуры
    validateCallbackData(regenerateCallback, '🔄 Перегенерировать');
    validateCallbackData(feedbackCallback, '✏️ С уточнением');

    const keyboard = new InlineKeyboard()
      .text('🔄 Перегенерировать', regenerateCallback)
      .text('✏️ С уточнением', feedbackCallback);

    await ctx.reply(`✅ <b>Пост ${postNumber}</b>\n\n${post.text}`, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });

    console.log(`[NataliaChannelPost] Successfully sent post ${post.id} (#${postNumber})`);
  } catch (error) {
    console.error(`[NataliaChannelPost] Failed to send post ${post.id}:`, {
      error: error instanceof Error ? error.message : String(error),
      postId: post.id,
      postNumber,
    });
    throw error;
  }
}

export async function finishAndShowButton(
  ctx: Context,
  posts: NataliaChannelPostData[]
): Promise<void> {
  let sentCount = 0;
  let failedCount = 0;

  // Отправляем посты с изоляцией ошибок — если один пост упал, остальные всё равно отправятся
  for (let i = 0; i < posts.length; i++) {
    const post = posts[i];
    const number = i + 1;

    try {
      await sendSinglePost(ctx, post, number);
      sentCount++;
    } catch (error) {
      failedCount++;
      console.error(`[NataliaChannelPost] Failed to send post ${post.id} (#${number}):`, {
        error: error instanceof Error ? error.message : String(error),
        postId: post.id,
        postNumber: number,
      });

      // Уведомляем пользователя, но продолжаем отправку остальных постов
      try {
        await ctx.reply(
          `⚠️ Не удалось отправить пост #${number}\n\n` +
          `Ошибка: ${error instanceof Error ? error.message : 'Неизвестная ошибка'}`,
          { parse_mode: 'HTML' }
        );
      } catch (replyError) {
        console.error('[NataliaChannelPost] Failed to send error notification:', replyError);
      }
    }

    if (i < posts.length - 1) {
      await sleep(DELAY_BETWEEN_POSTS_MS);
    }
  }

  // Формируем итоговое сообщение
  let summary = sentCount > 0 
    ? `✅ Готово! Сгенерировано ${sentCount} ${pluralizePost(sentCount)} из тем канала.`
    : '⚠️ Не удалось отправить ни одного поста.';

  if (failedCount > 0) {
    summary += `\n\n⚠️ Не удалось отправить: ${failedCount}`;
  }

  console.log('[NataliaChannelPost] Finished sending posts:', {
    total: posts.length,
    sent: sentCount,
    failed: failedCount,
  });

  if (posts.length >= POSTS_PER_RUN && sentCount > 0) {
    try {
      validateCallbackData(CALLBACK_PREFIX, '📝 Найти ещё пост');

      const keyboard = new InlineKeyboard().text(
        '📝 Найти ещё пост',
        CALLBACK_PREFIX
      );

      await ctx.reply(summary, { reply_markup: keyboard });
    } catch (error) {
      console.error('[NataliaChannelPost] Failed to create "More" button:', error);
      await ctx.reply(summary);
    }
  } else if (posts.length > 0) {
    await ctx.reply(
      `${summary}\n\n⚠️ Больше уникальных тем для канала сейчас не найдено`
    );
  } else {
    await ctx.reply(summary);
  }
}
