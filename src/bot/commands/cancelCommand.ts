/**
 * Callback-обработчик кнопки «Отменить» (callback_data: cancel:<commandId>).
 *
 * Валидация прав: commandId имеет вид `${userId}_${commandName}` — нажимать
 * «Отменить» может только владелец команды (ctx.from.id совпадает с префиксом).
 * Для крон-команд владелец — админ, поэтому обычный пользователь не сможет
 * отменить крон, даже узнав commandId (защита от подделки callback_data).
 */

import type { Context } from 'grammy';
import { commandManager } from '../../shared/utils/CommandManager/CommandManager';
import { parseCancelCallbackData } from '../../shared/utils/CommandManager/cancelButton';

export async function handleCancelCallback(ctx: Context): Promise<void> {
  try {
    const commandId = parseCancelCallbackData(ctx.callbackQuery?.data);

    if (!commandId) {
      await ctx.answerCallbackQuery({ text: '❌ Неверные данные' });
      return;
    }

    const userId = ctx.from?.id;

    if (userId === undefined || !commandId.startsWith(`${userId}_`)) {
      await ctx.answerCallbackQuery({
        text: '❌ Нельзя отменить чужую команду',
      });
      return;
    }

    try {
      await ctx.answerCallbackQuery({ text: 'Отменяю…' });
    } catch (answerError: any) {
      // Если callback устарел (>30 сек) — это нормально, просто логируем
      if (answerError?.error_code === 400 && answerError?.description?.includes('query is too old')) {
        console.log('[Cancel] Callback query expired (user clicked after 30s), continuing with cancellation');
      } else {
        console.error('[Cancel] Failed to answer callback query:', answerError);
      }
    }

    const cancelled = commandManager.cancel(commandId);
    
    if (!cancelled) {
      console.log('[Cancel] Command already completed:', commandId);
    }
  } catch (error) {
    console.error('[Cancel] Error in cancel callback:', error);
  }
}
