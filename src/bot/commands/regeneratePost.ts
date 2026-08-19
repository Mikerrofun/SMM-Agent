import type { Context } from 'grammy';
import { InlineKeyboard } from 'grammy';
import {
  regenerateGeneratedPost,
  regenerateTranscriptPost,
} from '../../services/post/postRegenerationService';
import type { 
  PostType, 
  WaitingForFeedbackState 
} from '../../services/post/postRegenerationService.types';
import { validateFeedback } from '../../shared/utils/feedbackValidator';

export const waitingForFeedback = new Map<number, WaitingForFeedbackState>();

export async function handleRegeneratePostCallback(ctx: Context): Promise<void> {
  try {
    const callbackData = ctx.callbackQuery?.data;
    if (!callbackData) {
      await ctx.answerCallbackQuery({ text: '❌ Неверные данные' });
      return;
    }

    const isGenerated = callbackData.startsWith('regenerate_idea_post:');
    const isTranscript = callbackData.startsWith('regenerate_transcript_post:');

    if (!isGenerated && !isTranscript) {
      await ctx.answerCallbackQuery({ text: '❌ Неверные данные' });
      return;
    }

    const postType: PostType = isGenerated ? 'generated' : 'transcript';
    const prefix = isGenerated ? 'regenerate_idea_post:' : 'regenerate_transcript_post:';
    const postId = callbackData.replace(prefix, '');
    const chatId = ctx.chat?.id;
    const messageId = ctx.callbackQuery?.message?.message_id;

    await ctx.answerCallbackQuery({ text: '⏳ Генерирую...' });

    if (chatId && messageId) {
      try {
        await ctx.api.deleteMessage(chatId, messageId);
      } catch (deleteError) {
        console.error('[Regenerate] Failed to delete old message:', deleteError);
      }
    }

    const statusMessage = await ctx.reply('⏳ Генерирую новый пост...');

    const result = postType === 'generated'
      ? await regenerateGeneratedPost(postId)
      : await regenerateTranscriptPost(postId);

    try {
      await ctx.api.deleteMessage(ctx.chat!.id, statusMessage.message_id);
    } catch (deleteError) {
      console.error('[Regenerate] Failed to delete status message:', deleteError);
    }

    if (!result.success) {
      await ctx.reply(
        `❌ <b>Не удалось перегенерировать пост</b>\n\n` +
          `Ошибка: ${result.error}`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    const callbackPrefix = postType === 'generated' ? 'regenerate_idea_post' : 'regenerate_transcript_post';
    const keyboard = new InlineKeyboard()
      .text('🔄 Перегенерировать', `${callbackPrefix}:${postId}`)
      .text('✏️ С уточнением', `${callbackPrefix}_feedback:${postId}`);

    await ctx.reply(`✅ <b>Новый вариант поста:</b>\n\n${result.postText}`, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });

    console.log(`[Regenerate] Successfully regenerated ${postType} post ${postId}`);
  } catch (error) {
    console.error('[Regenerate] Error in post regeneration:', error);

    const errorMessage = error instanceof Error ? error.message : 'Неизвестная ошибка';

    try {
      await ctx.reply(
        `❌ <b>Произошла ошибка при перегенерации</b>\n\n${errorMessage}`,
        { parse_mode: 'HTML' }
      );
    } catch (replyError) {
      console.error('[Regenerate] Failed to send error message:', replyError);
    }
  }
}

export async function handleRegeneratePostFeedbackCallback(ctx: Context): Promise<void> {
  try {
    const callbackData = ctx.callbackQuery?.data;
    if (!callbackData) {
      await ctx.answerCallbackQuery({ text: '❌ Неверные данные' });
      return;
    }

    const isGenerated = callbackData.startsWith('regenerate_idea_post_feedback:');
    const isTranscript = callbackData.startsWith('regenerate_transcript_post_feedback:');

    if (!isGenerated && !isTranscript) {
      await ctx.answerCallbackQuery({ text: '❌ Неверные данные' });
      return;
    }

    const postType: PostType = isGenerated ? 'generated' : 'transcript';
    const prefix = isGenerated ? 'regenerate_idea_post_feedback:' : 'regenerate_transcript_post_feedback:';
    const postId = callbackData.replace(prefix, '');
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    const messageId = ctx.callbackQuery?.message?.message_id;

    if (!userId) {
      await ctx.answerCallbackQuery({ text: '❌ Не удалось определить пользователя' });
      return;
    }

    await ctx.answerCallbackQuery({ text: '✏️ Напишите что не понравилось' });

    if (chatId && messageId) {
      try {
        await ctx.api.deleteMessage(chatId, messageId);
      } catch (deleteError) {
        console.error('[Regenerate] Failed to delete old message:', deleteError);
      }
    }

    waitingForFeedback.set(userId, {
      postId,
      postType,
      originalMessageId: messageId ?? 0,
    });

    await ctx.reply(
      '✏️ <b>Напишите что не понравилось в посте</b>\n\n' +
        'Опишите свои замечания (максимум 1000 символов).\n' +
        'Я учту их при перегенерации.',
      { parse_mode: 'HTML' }
    );

    console.log(`[Regenerate] Waiting for feedback from user ${userId} for post ${postId}`);
  } catch (error) {
    console.error('[Regenerate] Error in post feedback callback:', error);

    try {
      await ctx.answerCallbackQuery({ text: '❌ Произошла ошибка' });
    } catch (replyError) {
      console.error('[Regenerate] Failed to answer callback query:', replyError);
    }
  }
}

export async function handleFeedbackMessage(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) {
    return;
  }

  const state = waitingForFeedback.get(userId);
  if (!state) {
    return;
  }

  const { postId, postType } = state;
  const feedbackText = ctx.message?.text;

  if (!feedbackText) {
    return;
  }

  let statusMessageId: number | undefined;

  try {
    const validatedFeedback = validateFeedback(feedbackText);

    const statusMessage = await ctx.reply('⏳ Генерирую с учётом ваших замечаний...');
    statusMessageId = statusMessage.message_id;

    const result = postType === 'generated'
      ? await regenerateGeneratedPost(postId, validatedFeedback)
      : await regenerateTranscriptPost(postId, validatedFeedback);

    if (statusMessageId && ctx.chat) {
      try {
        await ctx.api.deleteMessage(ctx.chat.id, statusMessageId);
      } catch (deleteError) {
        console.error('[Regenerate] Failed to delete status message:', deleteError);
      }
      statusMessageId = undefined;
    }

    if (!result.success) {
      await ctx.reply(
        `❌ <b>Не удалось перегенерировать пост</b>\n\n` +
          `Ошибка: ${result.error}`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    const callbackPrefix = postType === 'generated' ? 'regenerate_idea_post' : 'regenerate_transcript_post';
    const keyboard = new InlineKeyboard()
      .text('🔄 Перегенерировать', `${callbackPrefix}:${postId}`)
      .text('✏️ С уточнением', `${callbackPrefix}_feedback:${postId}`);

    await ctx.reply(`✅ <b>Новый вариант поста:</b>\n\n${result.postText}`, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });

    console.log(`[Regenerate] Successfully regenerated ${postType} post ${postId} with feedback`);
  } catch (error) {
    console.error('[Regenerate] Error processing feedback:', error);

    if (statusMessageId && ctx.chat) {
      try {
        await ctx.api.deleteMessage(ctx.chat.id, statusMessageId);
      } catch {
        // Игнорируем
      }
    }

    const errorMessage = error instanceof Error ? error.message : 'Неизвестная ошибка';

    try {
      await ctx.reply(
        `❌ <b>Произошла ошибка при перегенерации</b>\n\n${errorMessage}`,
        { parse_mode: 'HTML' }
      );
    } catch (replyError) {
      console.error('[Regenerate] Failed to send error message:', replyError);
    }
  } finally {
    waitingForFeedback.delete(userId);
  }
}
