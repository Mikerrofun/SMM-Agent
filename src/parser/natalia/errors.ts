export class ParserError extends Error {
  constructor(message: string, public cause?: Error) {
    super(message);
    this.name = 'ParserError';
    
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

export class TelegramAuthError extends ParserError {
  constructor(message: string, cause?: Error) {
    super(message, cause);
    this.name = 'TelegramAuthError';
  }
}

export class ChannelNotFoundError extends ParserError {
  constructor(
    public channelUsername: string,
    message?: string,
    cause?: Error
  ) {
    super(
      message || `Channel "${channelUsername}" not found or not accessible`,
      cause
    );
    this.name = 'ChannelNotFoundError';
  }
}

export class NetworkError extends ParserError {
  constructor(message: string, cause?: Error) {
    super(message, cause);
    this.name = 'NetworkError';
  }
}

// Проверка, является ли ошибка сетевой (для retry логики)
export function isNetworkError(error: unknown): boolean {
  if (error instanceof NetworkError) {
    return true;
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    const networkKeywords = [
      'network',
      'timeout',
      'econnrefused',
      'enotfound',
      'etimedout',
      'econnreset',
      'epipe',
      'socket',
      'flood',
      'rate limit',
    ];

    return networkKeywords.some((keyword) => message.includes(keyword));
  }

  return false;
}

