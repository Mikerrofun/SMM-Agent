import type { TranscriptPostData } from '../../shared/types/transcript.types';

export interface ProcessingStats {
  totalAttempts: number;
  uniquePosts: number;
  duplicatePosts: number;
  failedPosts: number;
}

export interface ProcessingResult {
  transcriptId: string;
  requestedPosts: number;
  posts: TranscriptPostData[];
  stats: ProcessingStats;
  errors: string[];
}
