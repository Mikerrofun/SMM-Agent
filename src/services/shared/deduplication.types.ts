export type DuplicateSource = 'idea' | 'nataliaPost' | 'transcriptPost' | 'nataliaChannelPost';

/**
 * Причина отбраковки по релевантности: контент не дубль,
 * но слишком похож на посты канала Натальи (nataliaSimilarity < MIN_NATALIA_SIMILARITY).
 */
export type RelevanceRejectionReason = 'natalia_relevance';

/** Тип источника дубля: либо один из источников дедупликации, либо причина отбраковки по релевантности. */
export type DuplicateOfType = DuplicateSource | RelevanceRejectionReason;

export interface SimilarityMatch {
  readonly id: string;
  readonly similarity: number;
  readonly createdAt?: Date;
}

export interface BaseDuplicationResult {
  isDuplicate: boolean;
  maxSimilarity: number;
  source: DuplicateSource | null;
  matchedId: string | null;
  /** Максимальная схожесть именно с постами канала Натальи (NataliaPost + NataliaChannelPost). */
  nataliaSimilarity: number;
  /** true — контент не дубль, но отбракован фильтром релевантности (nataliaSimilarity < MIN_NATALIA_SIMILARITY). */
  relevanceRejected: boolean;
}

export type DuplicationResult = BaseDuplicationResult;

export interface EmbeddingCheckResult extends BaseDuplicationResult {
  embedding: number[];
}

export interface DeduplicationStats {
  total: number;
  unique: number;
  duplicates: number;
  duplicatesWithIdeas: number;
  duplicatesWithNataliaPosts: number;
  duplicatesWithTranscriptPosts: number;
  duplicatesWithNataliaChannelPosts: number;
  failed: number;
  failedItems: Array<{
    id: string;
    error: string;
  }>;
}

export interface DeduplicateIdeasOptions {
  onProgress?: (current: number, total: number) => void;
}
