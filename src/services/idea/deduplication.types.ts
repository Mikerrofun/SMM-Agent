export type DuplicateOfType = 'idea' | 'nataliaPost';

export interface SimilarityMatch {
  readonly id: string;
  readonly similarity: number;
  readonly createdAt?: Date;
}

export interface DeduplicationResult {
  readonly ideaId: string;
  readonly isDuplicate: boolean;
  readonly duplicateOfType?: DuplicateOfType;
  readonly duplicateOfId?: string;
  readonly similarity?: number;
}

export interface DeduplicationStats {
  total: number;
  unique: number;
  duplicates: number;
  duplicatesWithIdeas: number;
  duplicatesWithNataliaPosts: number;
  failed: number;
  failedItems: Array<{
    id: string;
    error: string;
  }>;
}

export interface DeduplicateIdeasOptions {
  onProgress?: (current: number, total: number) => void;
}
