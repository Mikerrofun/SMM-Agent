export type DuplicationSource = 'natalia' | 'transcript';

export interface DuplicationResult {
  isDuplicate: boolean;
  maxSimilarity: number;
  source: DuplicationSource | null;
  /** ID записи, с которой найдено максимальное совпадение. */
  matchedId: string | null;
}

export interface EmbeddingCheckResult extends DuplicationResult {
  embedding: number[];
}
