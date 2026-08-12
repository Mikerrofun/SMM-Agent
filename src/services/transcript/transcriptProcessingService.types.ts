import type { TranscriptPostData } from '../../shared/types/transcript.types';

export interface ProcessingStats {
  totalAttempts: number;
  uniquePosts: number;
  duplicatePosts: number;
  failedPosts: number;
}

export interface ProcessingResult {
  transcriptId: string;
  posts: TranscriptPostData[];
  stats: ProcessingStats;
  /** Ошибки, из-за которых какой-то из постов не удалось сгенерировать. */
  errors: string[];
}
