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

    const cancelled = commandManager.cancel(commandId);

    await ctx.answerCallbackQuery({
      text: cancelled ? 'Отменяю…' : 'Команда уже завершена',
    });
  } catch (error) {
    console.error('[Cancel] Error in cancel callback:', error);

    try {
      await ctx.answerCallbackQuery({ text: '❌ Произошла ошибка' });
    } catch (answerError) {
      console.error('[Cancel] Failed to answer callback query:', answerError);
    }
  }
}
