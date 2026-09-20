import type { TranscriptPostData } from '../../shared/types/transcript.types';
import type { PostGenerationStats } from '../shared/postGeneration/postGeneration.types';

/** Статистика генерации — общий контракт с shared-пайплайном. */
export type ProcessingStats = PostGenerationStats;

export interface ProcessingResult {
  transcriptId: string;
  requestedPosts: number;
  posts: TranscriptPostData[];
  stats: ProcessingStats;
  errors: string[];
}
