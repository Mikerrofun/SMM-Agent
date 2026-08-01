export const COMPETITORS_PARSER_CONFIG = {
  BATCH_SIZE: 20,                    // Размер батча для сохранения
  MESSAGES_PER_REQUEST: 100,         // Сообщений за один запрос
  DEFAULT_LOOKBACK_DAYS: 2,          // Дней назад при первом запуске
} as const;
