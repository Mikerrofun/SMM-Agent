import type { Api } from 'grammy';

/**
 * Итог рассылки: сколько чатов получили сообщение, сколько завершились ошибкой.
 */
export type BroadcastResult = {
  sent: number;
  failed: number;
};

/**
 * Опции формирования списка получателей рассылки.
 */
export type ResolveRecipientOptions = {
  /**
   * Чат инициатора: добавляется в конец списка, если его нет среди подписчиков,
   * чтобы инициатор всегда получил результат.
   */
  initiatorChatId?: string;
  /**
   * Чат, которому результат уже ушёл через ctx — вырезается из списка, чтобы не было дубля.
   */
  excludeChatId?: string;
};

/**
 * Дополнительные опции sendMessage (parse_mode и т.д.).
 */
export type SendMessageOptions = Parameters<Api['sendMessage']>[2];
