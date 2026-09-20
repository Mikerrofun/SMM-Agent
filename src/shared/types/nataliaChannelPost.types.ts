/**
 * Типы для постов, сгенерированных из главных идей канала Натальи
 * (команда /natalia_channel_post).
 */

import type { TranscriptPostStatus } from './transcript.types';

export interface NataliaChannelPostData {
  id: string;
  text: string;
  mainIdea: string;
  status: TranscriptPostStatus;
  duplicateOfType?: string | null;
  duplicateOfId?: string | null;
  similarity?: number | null;
  attemptNumber: number;
  createdAt: Date;
}

export interface CreateNataliaChannelPostInput {
  text: string;
  mainIdea: string;
  attemptNumber: number;
}
