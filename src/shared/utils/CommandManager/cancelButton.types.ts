/**
 * Формат reply_markup с инлайн-кнопкой отмены (совместим с Telegram API).
 */
export type CancelKeyboard = {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
};
