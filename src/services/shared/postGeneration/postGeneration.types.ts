/**
 * Типы общего пайплайна генерации постов (src/services/shared/postGeneration/).
 *
 * Пайплайн параметризован зависимостями: функция генерации текста, репозиторий,
 * конфиг попыток и targetSource для дедупликации передаются снаружи.
 * Потребители: transcript_post (TranscriptPost) и natalia_channel_post (NataliaChannelPost).
 */

import type { DuplicateSource, DuplicateOfType } from '../deduplication.types';
import type { RetryConfig } from '../../../shared/utils/retry';

export type GeneratedPostStatus = 'SENT' | 'REJECTED' | 'DUPLICATE';

/** Базовый контракт поста, с которым работает общий пайплайн. */
export interface GeneratedPostBase {
  id: string;
  mainIdea: string;
  status: GeneratedPostStatus;
  similarity?: number | null;
  duplicateOfType?: string | null;
  duplicateOfId?: string | null;
}

export interface PostGenerationStats {
  totalAttempts: number;
  uniquePosts: number;
  duplicatePosts: number;
  failedPosts: number;
}

export function createPostGenerationStats(): PostGenerationStats {
  return {
    totalAttempts: 0,
    uniquePosts: 0,
    duplicatePosts: 0,
    failedPosts: 0,
  };
}

/** Адаптер репозитория: операции с постами, нужные пайплайну. */
export interface PostRepositoryAdapter<
  TPost extends GeneratedPostBase,
  TCreateInput,
> {
  create(input: TCreateInput): Promise<TPost>;
  updateEmbedding(id: string, embedding: number[]): Promise<void>;
  updateSimilarity(id: string, similarity: number): Promise<void>;
  updateStatus(id: string, status: GeneratedPostStatus): Promise<void>;
  markAsDuplicate(
    id: string,
    duplicateOfType: DuplicateOfType,
    duplicateOfId: string,
    similarity: number
  ): Promise<void>;
}

export interface PostGenerationConfig {
  /** Максимум попыток на один пост (генерация → дедуп). */
  maxAttemptsPerPost: number;
  /** Retry-конфиг для AI-вызовов (генерация текста, extractMainIdea). */
  retryConfig: RetryConfig;
  /** targetSource для resolveBestMatch (кто проверяется). */
  targetSource: DuplicateSource;
}

/** Проверка дедупликации: mainIdea → embedding + результат проверки. */
export type DuplicationChecker = (mainIdea: string) => Promise<{
  isDuplicate: boolean;
  maxSimilarity: number;
  source: DuplicateSource | null;
  matchedId: string | null;
  nataliaSimilarity: number;
  relevanceRejected: boolean;
  embedding: number[];
}>;

export interface PostGenerationDeps<
  TPost extends GeneratedPostBase,
  TCreateInput,
> {
  repository: PostRepositoryAdapter<TPost, TCreateInput>;
  config: PostGenerationConfig;
  checkDuplication: DuplicationChecker;
  generateText: (usedMainIdeas: string[]) => Promise<string>;
  extractMainIdea: (postText: string) => Promise<string>;
  createInput: (params: {
    text: string;
    mainIdea: string;
    attemptNumber: number;
  }) => TCreateInput;
  /** Префикс для console.log (например, '[TranscriptProcessing]'). */
  logPrefix: string;
  /** Дополнительный контекст для логов (например, transcriptId). */
  logContext?: Record<string, unknown>;
}

export interface AdditionalPostDeps<TPost extends GeneratedPostBase> {
  /** «Уже раскрытые темы» — mainIdea всех SENT-постов. */
  getUsedMainIdeas: () => Promise<string[]>;
  generateSingle: (
    usedMainIdeas: string[],
    postIndex: number,
    stats: PostGenerationStats,
    errors: string[]
  ) => Promise<TPost | null>;
  logPrefix: string;
  logContext?: Record<string, unknown>;
}

export interface AdditionalPostResult<TPost> {
  success: boolean;
  post?: TPost;
  reason?: 'no_unique_topics' | 'error';
  error?: string;
}
