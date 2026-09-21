import type { Context } from 'grammy';
import { InlineKeyboard } from 'grammy';
import {
  regenerateGeneratedPost,
  regenerateTranscriptPost,
  regenerateNataliaChannelPost,
} from '../../services/post/postRegenerationService';
import type {
  PostType,
  WaitingForFeedbackState
} from '../../services/post/postRegenerationService.types';
import { validateFeedback } from '../../shared/utils/feedbackValidator';
import { validateCallbackData } from '../../shared/utils/callbackDataValidator';

export const waitingForFeedback = new Map<number, WaitingForFeedbackState>();

const REGENERATE_PREFIXES: Array<{ prefix: string; postType: PostType }> = [
  { prefix: 'regenerate_idea_post:', postType: 'generated' },
  { prefix: 'regenerate_transcript_post:', postType: 'transcript' },
  { prefix: 'regen_natalia_post:', postType: 'nataliaChannel' },
];

const REGENERATE_FEEDBACK_PREFIXES: Array<{ prefix: string; postType: PostType }> = [
  { prefix: 'regenerate_idea_post_feedback:', postType: 'generated' },
  { prefix: 'regenerate_transcript_post_feedback:', postType: 'transcript' },
  { prefix: 'regen_natalia_post_feedback:', postType: 'nataliaChannel' },
];

function getCallbackPrefix(postType: PostType): string {
  switch (postType) {
    case 'generated':
      return 'regenerate_idea_post';
    case 'transcript':
      return 'regenerate_transcript_post';
    case 'nataliaChannel':
      return 'regen_natalia_post';
  }
}

export async function handleRegeneratePostCallback(ctx: Context): Promise<void> {
  try {
    const callbackData = ctx.callbackQuery?.data;
    if (!callbackData) {
      await ctx.answerCallbackQuery({ text: '❌ Неверные данные' });
      return;
    }

    const matched = REGENERATE_PREFIXES.find((entry) =>
      callbackData.startsWith(entry.prefix)
    );

    if (!matched) {
      await ctx.answerCallbackQuery({ text: '❌ Неверные данные' });
      return;
    }

    const postType: PostType = matched.postType;
    const postId = callbackData.replace(matched.prefix, '');

    if (!postId) {
      await ctx.answerCallbackQuery({ text: '❌ Неверный ID поста' });
      console.error('[Regenerate] Post ID is missing:', { callbackData, postType });
      return;
    }

    await ctx.answerCallbackQuery({ text: '⏳ Генерирую...' });

    const statusMessage = await ctx.reply('⏳ Генерирую новый пост...');

    const result = postType === 'generated'
      ? await regenerateGeneratedPost(postId)
      : postType === 'transcript'
        ? await regenerateTranscriptPost(postId)
        : await regenerateNataliaChannelPost(postId);

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

    const callbackPrefix = getCallbackPrefix(postType);
    const regenerateCallback = `${callbackPrefix}:${postId}`;
    const feedbackCallback = `${callbackPrefix}_feedback:${postId}`;

    // Валидируем callback_data перед созданием клавиатуры
    validateCallbackData(regenerateCallback, '🔄 Перегенерировать', '[Regenerate]');
    validateCallbackData(feedbackCallback, '✏️ С уточнением', '[Regenerate]');

    const keyboard = new InlineKeyboard()
      .text('🔄 Перегенерировать', regenerateCallback)
      .text('✏️ С уточнением', feedbackCallback);

    await ctx.reply(`✅ <b>Новый вариант поста:</b>\n\n${result.postText}`, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });

    if (ctx.msg) {
    try {
      await ctx.api.deleteMessage(ctx.msg.chat.id, ctx.msg.message_id);
    } catch (deleteError) {
      console.error('[Regenerate] Failed to delete old message:', deleteError);
    }
    }

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

    const matched = REGENERATE_FEEDBACK_PREFIXES.find((entry) =>
      callbackData.startsWith(entry.prefix)
    );

    if (!matched) {
      await ctx.answerCallbackQuery({ text: '❌ Неверные данные' });
      return;
    }

    const postType: PostType = matched.postType;
    const postId = callbackData.replace(matched.prefix, '');
    const userId = ctx.from?.id;
    const messageId = ctx.callbackQuery?.message?.message_id;

    if (!userId) {
      await ctx.answerCallbackQuery({ text: '❌ Не удалось определить пользователя' });
      return;
    }

    await ctx.answerCallbackQuery({ text: '✏️ Напишите что не понравилось' });


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

  if (!postId) {
    console.error('[Regenerate] Post ID is missing in feedback state:', { userId, postType });
    await ctx.reply('❌ Ошибка: не удалось определить ID поста');
    waitingForFeedback.delete(userId);
    return;
  }

  let statusMessageId: number | undefined;

  try {
    const validatedFeedback = validateFeedback(feedbackText);

    const statusMessage = await ctx.reply('⏳ Генерирую с учётом ваших замечаний...');
    statusMessageId = statusMessage.message_id;

    const result = postType === 'generated'
      ? await regenerateGeneratedPost(postId, validatedFeedback)
      : postType === 'transcript'
        ? await regenerateTranscriptPost(postId, validatedFeedback)
        : await regenerateNataliaChannelPost(postId, validatedFeedback);

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

    const callbackPrefix = getCallbackPrefix(postType);
    const regenerateCallback = `${callbackPrefix}:${postId}`;
    const feedbackCallback = `${callbackPrefix}_feedback:${postId}`;

    // Валидируем callback_data перед созданием клавиатуры
    validateCallbackData(regenerateCallback, '🔄 Перегенерировать', '[Regenerate]');
    validateCallbackData(feedbackCallback, '✏️ С уточнением', '[Regenerate]');

    const keyboard = new InlineKeyboard()
      .text('🔄 Перегенерировать', regenerateCallback)
      .text('✏️ С уточнением', feedbackCallback);

    await ctx.reply(`✅ <b>Новый вариант поста:</b>\n\n${result.postText}`, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });

    if (ctx.msg) {
    try {
      await ctx.api.deleteMessage(ctx.msg.chat.id, ctx.msg.message_id);
    } catch (deleteError) {
      console.error('[Regenerate] Failed to delete old message:', deleteError);
    }
    }

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
