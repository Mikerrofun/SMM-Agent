// пауза между отправкой постов, чтобы не влететь в rate limit Telegram
export const DELAY_BETWEEN_POSTS_MS = 500;

/**
 * Префикс для callback_data кнопки "Найти ещё пост".
 * Используется для идентификации нажатий на эту кнопку.
 */
export const CALLBACK_PREFIX = 'natalia_channel_more:';
