/**
 * Типы для фичи генерации постов из транскрипций встреч с клиентами.
 */

export interface ClientTranscriptData {
  id: string;
  text: string;
  fileName?: string | null;
  uploadedAt: Date;
  processedAt?: Date | null;
}

export interface TranscriptPostData {
  id: string;
  transcriptId: string;
  text: string;
  mainIdea: string;
  isDuplicate: boolean;
  similarity?: number | null;
  attemptNumber: number;
  createdAt: Date;
}

export interface CreateTranscriptInput {
  text: string;
  fileName?: string;
}

export interface CreateTranscriptPostInput {
  transcriptId: string;
  text: string;
  mainIdea: string;
  attemptNumber: number;
}
