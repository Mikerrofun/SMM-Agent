/**
 * Custom error classes for idea processing pipeline
 * 
 * These errors provide detailed context about failures during idea generation,
 * embedding creation, and database operations. Each error class maintains a
 * chain of causality through the `cause` field, enabling detailed error logging.
 */

import type { IdeaProcessStage } from '../../shared/types/idea.types';

export class IdeaProcessError extends Error {
  constructor(message: string, public cause?: Error) {
    super(message);
    this.name = 'IdeaProcessError';
    
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

export class IdeaExtractionError extends IdeaProcessError {
  constructor(message: string, cause?: Error) {
    super(message, cause);
    this.name = 'IdeaExtractionError';
  }
}

export class EmbeddingGenerationError extends IdeaProcessError {
  constructor(message: string, cause?: Error) {
    super(message, cause);
    this.name = 'EmbeddingGenerationError';
  }
}

export class IdeaSaveError extends IdeaProcessError {
  constructor(message: string, cause?: Error) {
    super(message, cause);
    this.name = 'IdeaSaveError';
  }
}

/**
 * Format error for logging with context
 * 
 * @param error - The error that occurred (can be any type)
 * @param stage - The stage where the error occurred
 * @param postId - The competitor post ID being processed
 * @returns Formatted error message with full context
 */

export function formatIdeaProcessError(
  error: unknown,
  stage: IdeaProcessStage,
  postId: string
): string {
  let message: string;
  let causedBy = '';

  if (error instanceof IdeaProcessError) {
    message = error.message;
    if (error.cause) {
      causedBy = ` (caused by: ${error.cause.message})`;
    }
  } else if (error instanceof Error) {
    message = error.message;
  } else {
    message = String(error);
  }

  return `[${stage}] ${postId}: ${message}${causedBy}`;
}
