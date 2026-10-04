/**
 * Хендлеры флоу /ideas:
 * 1) команда показывает inline-выбор категории;
 * 2) нажатие на кнопку отправляет порцию идей всем получателям.
 */

import type { Context } from 'grammy';
import {
  getFreshIdeasForSending,
  getNewIdeasForSending,
  getOldestIdeasForSending,
} from '../../../repositories/ideaRepository';
import type { IdeasFetcher, IdeasSelectionMode } from './ideas.types';
import {
  INVALID_CALLBACK_TEXT,
  IDEAS_BATCH_SIZE,
  NO_IDEAS_TEXT,
  SENDING_TOAST_TEXT,
  SELECTION_EXPIRED_TEXT,
  SELECTION_PROMPT_TEXT,
  SEND_IN_PROGRESS_TEXT,
} from './config';
import {
  buildIdeasSelectionKeyboard,
  buildRunPipelineKeyboard,
  parseIdeasSelectionCallbackData,
} from './selectionKeyboard';
import { sendIdeasBatch } from './sender';
import {
  clearSelection,
  finishSending,
  isSending,
  saveSelection,
  startSending,
  takeSelection,
} from './state';


const IDEAS_FETCHERS: Record<IdeasSelectionMode, IdeasFetcher> = {
  new: getNewIdeasForSending,
  fresh: getFreshIdeasForSending,
  old: getOldestIdeasForSending,
};

export async function handleIdeasCommand(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;

  if (!userId) {
    return;
  }

  if (isSending(userId)) {
    await ctx.reply(SEND_IN_PROGRESS_TEXT);
    return;
  }

  saveSelection(userId);

  await ctx.reply(SELECTION_PROMPT_TEXT, {
    reply_markup: buildIdeasSelectionKeyboard(),
  });
}


export async function handleIdeasSelectionCallback(ctx: Context): Promise<void> {
  const mode = parseIdeasSelectionCallbackData(ctx.callbackQuery?.data);

  if (!mode) {
    await ctx.answerCallbackQuery({ text: INVALID_CALLBACK_TEXT });
    return;
  }

  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;

  if (!userId || !chatId) {
    await ctx.answerCallbackQuery({ text: INVALID_CALLBACK_TEXT });
    return;
  }

  await ctx.answerCallbackQuery({ text: SENDING_TOAST_TEXT });

  try {
    await ctx.editMessageReplyMarkup({ reply_markup: undefined });
  } catch (error) {
    console.error('[Ideas] Failed to remove selection keyboard:', error);
  }

  const selection = takeSelection(userId);

  if (!selection) {
    await ctx.answerCallbackQuery({ text: SELECTION_EXPIRED_TEXT });
    return;
  }

  if (!startSending(userId)) {
    await ctx.reply(SEND_IN_PROGRESS_TEXT);
    return;
  }

  try {
    const ideas = await IDEAS_FETCHERS[mode](IDEAS_BATCH_SIZE);

    if (ideas.length === 0) {
      console.log('[Ideas] 📭 Порция пуста для режима', mode);
      await ctx.reply(NO_IDEAS_TEXT, {
        reply_markup: buildRunPipelineKeyboard(),
      });
      return;
    }

    const result = await sendIdeasBatch(ctx.api, ideas, chatId.toString());

    console.log('[Ideas] Порция отправлена', {
      mode,
      ...result,
    });
  } catch (error) {
    console.error('[Ideas] Error in ideas selection callback:', error);

    const errorMessage =
      error instanceof Error && error.message.includes('does not exist')
        ? '❌ Ошибка подключения к базе данных.\nПроверьте DATABASE_URL в .env'
        : '❌ Произошла ошибка при загрузке идей. Попробуйте позже.';

    try {
      await ctx.reply(errorMessage);
    } catch (replyError) {
      console.error('[Ideas] Failed to send error message:', replyError);
    }
  } finally {
    // Страховка: состояние уже забрано, но на случай падения до этого шага
    clearSelection(userId);
    finishSending(userId);
  }
}
