/**
 * Единая точка создания клавиатуры отмены и разбора callback_data отмены.
 *
 * commandId имеет вид `${userId}_${commandName}` и кодируется в callback_data
 * как `cancel:<commandId>`.
 */

import type { CancelKeyboard } from './cancelButton.types';

export const CANCEL_CALLBACK_PREFIX = 'cancel:';
export const CANCEL_BUTTON_TEXT = '❌ Отменить';

export function buildCommandId(userId: number, commandName: string): string {
  return `${userId}_${commandName}`;
}

/**
 * Готовый reply_markup со стартового сообщения команды.
 */
export function buildCancelKeyboard(commandId: string): CancelKeyboard {
  return {
    inline_keyboard: [
      [
        {
          text: CANCEL_BUTTON_TEXT,
          callback_data: `${CANCEL_CALLBACK_PREFIX}${commandId}`,
        },
      ],
    ],
  };
}

/**
 * Разбирает callback_data вида `cancel:<commandId>`.
 * Возвращает null, если строка не относится к отмене или commandId пуст.
 */
export function parseCancelCallbackData(data: string | undefined): string | null {
  if (!data || !data.startsWith(CANCEL_CALLBACK_PREFIX)) {
    return null;
  }

  const commandId = data.slice(CANCEL_CALLBACK_PREFIX.length);
  return commandId.length > 0 ? commandId : null;
}
