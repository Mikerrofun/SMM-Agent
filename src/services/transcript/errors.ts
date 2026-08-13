/**
 * Классы ошибок для пайплайна генерации постов из транскрипций.
 */

export class TranscriptProcessingError extends Error {
  constructor(message: string, public cause?: Error) {
    super(message);
    this.name = 'TranscriptProcessingError';

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

export class TranscriptNotFoundError extends TranscriptProcessingError {
  constructor(transcriptId: string) {
    super(`Transcript not found: ${transcriptId}`);
    this.name = 'TranscriptNotFoundError';
  }
}

export class AlreadyProcessedError extends TranscriptProcessingError {
  constructor(transcriptId: string) {
    super(`Transcript already processed: ${transcriptId}`);
    this.name = 'AlreadyProcessedError';
  }
}

export class GenerationFailedError extends TranscriptProcessingError {
  constructor(message: string, cause?: Error) {
    super(message, cause);
    this.name = 'GenerationFailedError';
  }
}

export class DeduplicationError extends TranscriptProcessingError {
  constructor(message: string, cause?: Error) {
    super(message, cause);
    this.name = 'DeduplicationError';
  }
}
