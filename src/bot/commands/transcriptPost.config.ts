/**
 * Настройки команды /transcript_post.
 *
 * Здесь только транспортные лимиты Telegram-слоя. Параметры генерации
 * (сколько постов, сколько попыток) живут в services/transcript/transcript.config.ts,
 * параметры LLM — в ai/transcriptPostGenerator.config.ts.
 */

/** Максимальный размер PDF, который принимаем от пользователя. */
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

/** Человекочитаемый лимит для текста ошибки — держим в паре с MAX_FILE_SIZE_BYTES. */
export const MAX_FILE_SIZE_LABEL = '10MB';

/** Пауза между отправкой постов, чтобы не влететь в rate limit Telegram. */
export const DELAY_BETWEEN_POSTS_MS = 500;
