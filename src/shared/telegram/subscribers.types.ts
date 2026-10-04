import type { Api } from 'grammy';

/**
 * Итог рассылки: сколько чатов получили сообщение, сколько завершились ошибкой.
 */
export type BroadcastResult = {
  sent: number;
  failed: number;
};

/**
 * Дополнительные опции sendMessage (parse_mode и т.д.).
 */
export type SendMessageOptions = Parameters<Api['sendMessage']>[2];
