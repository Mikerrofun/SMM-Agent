// Реэкспорт ошибок из shared модуля для обратной совместимости
export {
  ParserError,
  TelegramAuthError,
  ChannelNotFoundError,
  NetworkError,
  isNetworkError,
} from '../../shared/telegram/errors';
