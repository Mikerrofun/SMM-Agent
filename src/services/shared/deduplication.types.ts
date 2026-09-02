export type DuplicateSource = 'idea' | 'nataliaPost' | 'transcriptPost';

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
  failed: number;
  failedItems: Array<{
    id: string;
    error: string;
  }>;
}

export interface DeduplicateIdeasOptions {
  onProgress?: (current: number, total: number) => void;
}
