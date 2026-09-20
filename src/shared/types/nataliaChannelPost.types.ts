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

/**
 * ID временного статусного сообщения в Telegram
 * undefined = сообщение еще не отправлено
 * number = ID отправленного сообщения (для последующего удаления)
 */
export type StatusMessageId = number | undefined;
