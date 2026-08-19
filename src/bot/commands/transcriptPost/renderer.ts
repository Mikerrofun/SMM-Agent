/**
 * Отправка постов транскрипций в Telegram.
 */

import type { Context } from 'grammy';
import { InlineKeyboard } from 'grammy';
import { sleep } from '../../../shared/utils/sleep';
import type { TranscriptPostData } from '../../../shared/types/transcript.types';
import { POSTS_PER_TRANSCRIPT } from '../../../services/transcript/transcript.config';
import { CALLBACK_PREFIX, DELAY_BETWEEN_POSTS_MS } from './config';
import { pluralizePost } from './utils';


export async function sendSinglePost(
  ctx: Context,
  post: TranscriptPostData,
  postNumber: number
): Promise<void> {
  try {
    const keyboard = new InlineKeyboard()
      .text('🔄 Перегенерировать', `regenerate_transcript_post:${post.id}`)
      .text('✏️ С уточнением', `regenerate_transcript_post_feedback:${post.id}`);

    await ctx.reply(`✅ <b>Пост ${postNumber}</b>\n\n${post.text}`, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
  } catch (error) {
    console.error(`[TranscriptPost] Failed to send post ${post.id}:`, error);
    throw error;
  }
}

export async function finishAndShowButton(
  ctx: Context,
  posts: TranscriptPostData[],
  transcriptId: string
): Promise<void> {
  for (let i = 0; i < posts.length; i++) {
    const post = posts[i];
    const number = i + 1;

    try {
      await sendSinglePost(ctx, post, number);
    } catch (error) {
      console.error(`[TranscriptPost] Failed to send post ${post.id}:`, error);
    }

    if (i < posts.length - 1) {
      await sleep(DELAY_BETWEEN_POSTS_MS);
    }
  }

  const summary = `✅ Готово! Сгенерировано ${posts.length} ${pluralizePost(posts.length)} из транскрипции.`;

  if (posts.length >= POSTS_PER_TRANSCRIPT) {
    const keyboard = new InlineKeyboard().text(
      '📝 Найти ещё пост',
      `${CALLBACK_PREFIX}${transcriptId}`
    );

    await ctx.reply(summary, { reply_markup: keyboard });
  } else if (posts.length > 0) {
    await ctx.reply(
      `${summary}\n\n⚠️ Больше постов из этой встречи не найдено`
    );
  } else {
    await ctx.reply(summary);
  }
}
