/**
 * Классы ошибок для парсинга PDF-файлов.
 *
 * Паттерн повторяет src/services/idea/errors.ts:
 * базовый класс + специализированные наследники с полем cause.
 */

export class PdfParserError extends Error {
  constructor(message: string, public cause?: Error) {
    super(message);
    this.name = 'PdfParserError';

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/** PDF повреждён или это вообще не PDF. */
export class InvalidPdfError extends PdfParserError {
  constructor(message = 'Файл не является валидным PDF', cause?: Error) {
    super(message, cause);
    this.name = 'InvalidPdfError';
  }
}

/** PDF распарсился, но текста в нём нет (например, скан без OCR). */
export class EmptyPdfError extends PdfParserError {
  constructor(message = 'PDF не содержит текста', cause?: Error) {
    super(message, cause);
    this.name = 'EmptyPdfError';
  }
}

/** Текст есть, но его слишком мало для генерации постов. */
export class InsufficientContentError extends PdfParserError {
  constructor(message = 'В PDF слишком мало текста для генерации постов', cause?: Error) {
    super(message, cause);
    this.name = 'InsufficientContentError';
  }
}

/** PDF защищён паролем. */
export class PasswordProtectedPdfError extends PdfParserError {
  constructor(message = 'PDF защищён паролем', cause?: Error) {
    super(message, cause);
    this.name = 'PasswordProtectedPdfError';
  }
}
