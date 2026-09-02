import type {
  DuplicateSource,
  SimilarityMatch,
} from '../shared/deduplication.types';

export type { DuplicateSource, SimilarityMatch };

/**
 * Статистика батчевой дедупликации идей.
 */
export interface DeduplicationStats {
  total: number;
  unique: number;
  duplicates: number;
  duplicatesWithIdeas: number;
  duplicatesWithNataliaPosts: number;
  duplicatesWithTranscriptPosts: number;
  failed: number;
  failedItems: Array<{
    id: string;
    error: string;
  }>;
}

/**
 * Опции для функции deduplicateIdeas.
 */
export interface DeduplicateIdeasOptions {
  onProgress?: (current: number, total: number) => void;
}

