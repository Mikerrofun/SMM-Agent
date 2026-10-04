import type { Api } from 'grammy';
import type { BroadcastResult, SendMessageOptions } from './subscribers.types';

/**
 * Возвращает список chat_id подписчиков из переменной окружения SUBSCRIBER_CHAT_IDS.
 * Формат: "123456789,987654321"
 */
export function getSubscriberChatIds(): string[] {
  return (
    process.env.SUBSCRIBER_CHAT_IDS?.split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0) ?? []
  );
}

/**
 * Получатели результата: подписчики из SUBSCRIBER_CHAT_IDS + чат инициатора,
 * если он не подписчик.
 *
 * Это единственный путь доставки результата: инициатору тоже.
 * Проверять «кому уже ушло» не нужно — второй доставки нет.
 *
 * @param initiatorChatId - чат инициатора (того, кто нажал кнопку или позвал команду)
 * @returns список chat_id получателей (пустой список — не ошибка)
 */
export function getRecipientChatIds(initiatorChatId?: string): string[] {
  const recipients = getSubscriberChatIds();

  if (initiatorChatId && !recipients.includes(initiatorChatId)) {
    recipients.push(initiatorChatId);
  }

  return recipients;
}

/**
 * Отправляет сообщение списку чатов последовательно.
 * Ошибка по отдельному чату не прерывает рассылку.
 *
 * @param api - Telegram API (например, ctx.api или bot.api)
 * @param chatIds - список чатов-получателей
 * @param text - текст сообщения
 * @param options - дополнительные опции sendMessage (parse_mode и т.д.)
 * @returns количество успешных отправок и отправок с ошибкой
 */
export async function sendMessageToChats(
  api: Api,
  chatIds: string[],
  text: string,
  options?: SendMessageOptions
): Promise<BroadcastResult> {
  let sent = 0;
  let failed = 0;

  for (const chatId of chatIds) {
    try {
      await api.sendMessage(chatId, text, options);
      sent++;
    } catch (error) {
      failed++;
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[broadcast] ❌ Ошибка отправки в ${chatId}:`, errorMsg);
    }
  }

  return { sent, failed };
}
