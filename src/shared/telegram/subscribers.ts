import type { Api } from "grammy";

/**
 * Возвращает список chat_id подписчиков из переменной окружения SUBSCRIBER_CHAT_IDS.
 * Формат: "123456789,987654321"
 */
export function getSubscriberChatIds(): string[] {
  return (
    process.env.SUBSCRIBER_CHAT_IDS?.split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0) ?? []
  );
}

/**
 * Рассылает сообщение списку чатов. Ошибки по отдельным чатам не прерывают рассылку.
 * @param api - Telegram API (например, ctx.api или bot.api)
 * @param text - Текст сообщения
 * @param options - Дополнительные опции sendMessage (parse_mode и т.д.)
 * @param chatIds - Список чатов (по умолчанию все подписчики из .env)
 */
export async function broadcastToSubscribers(
  api: Api,
  text: string,
  options?: Parameters<Api["sendMessage"]>[2],
  chatIds: string[] = getSubscriberChatIds()
): Promise<{ sent: number; failed: number }> {
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
