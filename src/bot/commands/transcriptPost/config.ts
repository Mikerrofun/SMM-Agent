export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

// держим в паре с MAX_FILE_SIZE_BYTES
export const MAX_FILE_SIZE_LABEL = '10MB';

// пауза между отправкой постов, чтобы не влететь в rate limit Telegram
export const DELAY_BETWEEN_POSTS_MS = 500;

/**
 * Префикс для callback_data кнопки "Найти ещё пост".
 * Используется для идентификации нажатий на эту кнопку.
 */
export const CALLBACK_PREFIX = 'transcript_more:';
