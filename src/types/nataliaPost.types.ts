export interface CreateNataliaPostInput {
  text: string;
  telegramPostUrl: string;
  publishedAt: Date;
  mainIdea: string;
}

export interface ParseStatistics {
  total: number;
  saved: number;
  skipped: number;
  errors: number;
}

export type ProgressCallback = (current: number, total: number) => void;
