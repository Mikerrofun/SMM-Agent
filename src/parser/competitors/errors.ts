// Реэкспорт ошибок из shared модуля
export { 
  ParserError, 
  TelegramAuthError, 
  ChannelNotFoundError, 
  NetworkError, 
  isNetworkError 
} from '../../shared/telegram/errors';
