/**
 * Дедупликация постов, сгенерированных из транскрипций.
 *
 * Пост проверяется против:
 *  1) всех постов Натальи (NataliaPost)
 *  2) ранее сгенерированных TranscriptPost (кроме тех, что переданы в excludePostIds)
 *  3) идей (Ideas)
 *
 * Пороги дифференцированные через thresholdResolver.
 */

import { createEmbedding } from '../../ai/embeddings';
import { findSimilarNataliaPosts } from '../../repositories/nataliaPostRepository';
import { findSimilarPosts as findSimilarNataliaChannelPosts } from '../../repositories/nataliaChannelPostRepository';
import { findSimilarPosts } from '../../repositories/transcriptPostRepository';
import { findSimilarIdeasForTranscript } from '../../repositories/ideaRepository';
import { withRetry } from '../../shared/utils/retry';
import { DEDUPLICATION_RETRY_CONFIG } from '../shared/deduplication.config';
import { resolveBestMatch } from '../shared/similarityResolver';
import { isNataliaRelevanceRejected } from '../shared/relevanceFilter';
import { DeduplicationError } from './errors';
import type {
  DuplicationResult,
  EmbeddingCheckResult,
} from '../shared/deduplication.types';
import type { DuplicateSource } from '../shared/deduplication.types';


export async function checkPostDuplication(
  embedding: number[],
  targetSource: DuplicateSource = 'transcriptPost'
): Promise<DuplicationResult> {
  const [nataliaMatches, nataliaChannelMatches, transcriptMatches, ideaMatches] = await Promise.all([
    findSimilarNataliaPosts(embedding, 0),
    findSimilarNataliaChannelPosts(embedding, 0),
    findSimilarPosts(embedding, 0),
    findSimilarIdeasForTranscript(embedding, 0),
  ]);

  const { maxSimilarity, source, matchedId, nataliaSimilarity } = resolveBestMatch(targetSource, [
    { source: 'nataliaPost', matches: nataliaMatches },
    { source: 'nataliaChannelPost', matches: nataliaChannelMatches },
    { source: 'transcriptPost', matches: transcriptMatches },
    { source: 'idea', matches: ideaMatches },
  ]);

  const isDuplicate = source !== null && matchedId !== null;

  return {
    isDuplicate,
    maxSimilarity,
    source: isDuplicate ? source : null,
    matchedId: isDuplicate ? matchedId : null,
    nataliaSimilarity,
    relevanceRejected: isNataliaRelevanceRejected(nataliaSimilarity, isDuplicate),
  };
}


export async function generateAndCheckEmbedding(
  mainIdea: string,
  targetSource: DuplicateSource = 'transcriptPost'
): Promise<EmbeddingCheckResult> {
  try {
    const embedding = await withRetry(
      () => createEmbedding(mainIdea),
      DEDUPLICATION_RETRY_CONFIG
    );

    const result = await withRetry(
      () => checkPostDuplication(embedding, targetSource),
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
