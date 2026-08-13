/**
 * Дедупликация постов, сгенерированных из транскрипций.
 *
 * Пост проверяется против:
 *  1) всех постов Натальи (NataliaPost)
 *  2) ранее сгенерированных TranscriptPost (кроме тех, что переданы в excludePostIds)
 *
 * Порог переиспользуем из services/idea/deduplication.config.ts (0.75).
 */

import { createEmbedding } from '../../ai/embeddings';
import { findSimilarNataliaPosts } from '../../repositories/nataliaPostRepository';
import { findSimilarPosts } from '../../repositories/transcriptPostRepository';
import { withRetry } from '../../shared/utils/retry';
import {
  SIMILARITY_THRESHOLD,
  DEDUPLICATION_RETRY_CONFIG,
} from '../idea/deduplication.config';
import { DeduplicationError } from './errors';
import type {
  DuplicationResult,
  EmbeddingCheckResult,
} from './deduplication.types';


export async function checkPostDuplication(
  embedding: number[],
  excludePostIds: string[] = []
): Promise<DuplicationResult> {
  const [nataliaMatches, transcriptMatches] = await Promise.all([
    findSimilarNataliaPosts(embedding, 0),
    findSimilarPosts(embedding, 0, excludePostIds),
  ]);

  const bestNatalia = nataliaMatches[0];
  const bestTranscript = transcriptMatches[0];

  let maxSimilarity = 0;
  let source: DuplicationResult['source'] = null;
  let matchedId: string | null = null;

  if (bestNatalia && bestNatalia.similarity > maxSimilarity) {
    maxSimilarity = bestNatalia.similarity;
    source = 'natalia';
    matchedId = bestNatalia.id;
  }

  if (bestTranscript && bestTranscript.similarity > maxSimilarity) {
    maxSimilarity = bestTranscript.similarity;
    source = 'transcript';
    matchedId = bestTranscript.id;
  }

  const isDuplicate = maxSimilarity >= SIMILARITY_THRESHOLD;

  return {
    isDuplicate,
    maxSimilarity,
    source: isDuplicate ? source : null,
    matchedId: isDuplicate ? matchedId : null,
  };
}


export async function generateAndCheckEmbedding(
  mainIdea: string,
  excludePostIds: string[] = []
): Promise<EmbeddingCheckResult> {
  try {
    const embedding = await withRetry(
      () => createEmbedding(mainIdea),
      DEDUPLICATION_RETRY_CONFIG
    );

    const result = await withRetry(
      () => checkPostDuplication(embedding, excludePostIds),
      DEDUPLICATION_RETRY_CONFIG
    );

    return { ...result, embedding };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    throw new DeduplicationError(
      `Failed to check duplication: ${err.message}`,
      err
    );
  }
}
