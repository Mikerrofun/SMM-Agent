/**
 * Оркестрация генерации постов из транскрипции.
 *
 * Для каждого из POSTS_PER_TRANSCRIPT постов делаем до MAX_ATTEMPTS_PER_POST попыток:
 * генерация → mainIdea → embedding → проверка дублей.
 * Первая уникальная попытка принимается. Если все попытки дали дубли —
 * принимаем попытку с минимальной similarity и помечаем isDuplicate = true.
 */

import { extractMainIdea } from '../../ai/mainIdeaExtractor';
import { generatePostFromTranscript } from '../../ai/transcriptPostGenerator';
import {
  getTranscriptById,
  markAsProcessed,
} from '../../repositories/clientTranscriptRepository';
import {
  createTranscriptPost,
  markAsDuplicate,
  updateEmbedding,
  updateSimilarity,
} from '../../repositories/transcriptPostRepository';
import { withRetry } from '../../shared/utils/retry';
import type { TranscriptPostData } from '../../shared/types/transcript.types';
import { generateAndCheckEmbedding } from './deduplicationService';
import {
  AI_RETRY_CONFIG,
  MAX_ATTEMPTS_PER_POST,
  POSTS_PER_TRANSCRIPT,
} from './transcript.config';
import { TranscriptNotFoundError } from './errors';
import type {
  ProcessingResult,
  ProcessingStats,
} from './transcriptProcessingService.types';

interface AttemptCandidate {
  post: TranscriptPostData;
  similarity: number;
}

export async function processTranscript(
  transcriptId: string
): Promise<ProcessingResult> {
  console.log('[TranscriptProcessing] Starting', { transcriptId });

  const transcript = await getTranscriptById(transcriptId);

  if (!transcript) {
    throw new TranscriptNotFoundError(transcriptId);
  }

  const stats: ProcessingStats = {
    totalAttempts: 0,
    uniquePosts: 0,
    duplicatePosts: 0,
    failedPosts: 0,
  };

  const errors: string[] = [];
  const acceptedPosts: TranscriptPostData[] = [];
  const acceptedMainIdeas: string[] = [];

  for (let postIndex = 1; postIndex <= POSTS_PER_TRANSCRIPT; postIndex++) {
    let accepted: TranscriptPostData | null = null;
    let bestCandidate: AttemptCandidate | null = null;
    const draftIds: string[] = [];

    for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_POST; attempt++) {
      stats.totalAttempts++;

      try {
        const postText = await withRetry(
          () => generatePostFromTranscript(transcript.text, acceptedMainIdeas),
          AI_RETRY_CONFIG
        );

        const mainIdea = await withRetry(
          () => extractMainIdea(postText),
          AI_RETRY_CONFIG
        );

        const post = await createTranscriptPost({
          transcriptId,
          text: postText,
          mainIdea,
          attemptNumber: attempt,
        });

        draftIds.push(post.id);

        const dedupResult = await generateAndCheckEmbedding(mainIdea, draftIds);

        await updateEmbedding(post.id, dedupResult.embedding);

        console.log('[TranscriptProcessing] Attempt', {
          postIndex,
          attempt,
          similarity: Number(dedupResult.maxSimilarity.toFixed(4)),
          isDuplicate: dedupResult.isDuplicate,
          source: dedupResult.source,
        });

        if (!dedupResult.isDuplicate) {
          if (dedupResult.maxSimilarity > 0) {
            await updateSimilarity(post.id, dedupResult.maxSimilarity);
          }

          accepted = { ...post, similarity: dedupResult.maxSimilarity };
          acceptedMainIdeas.push(mainIdea);
          stats.uniquePosts++;
          break;
        }

        if (
          bestCandidate === null ||
          dedupResult.maxSimilarity < bestCandidate.similarity
        ) {
          bestCandidate = { post, similarity: dedupResult.maxSimilarity };
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`post ${postIndex}, attempt ${attempt}: ${message}`);
        console.error('[TranscriptProcessing] Attempt failed', {
          transcriptId,
          postIndex,
          attempt,
          error: message,
        });
      }
    }

    if (accepted === null && bestCandidate !== null) {
      const marked = await markAsDuplicate(
        bestCandidate.post.id,
        bestCandidate.similarity
      );
      accepted = marked;
      acceptedMainIdeas.push(bestCandidate.post.mainIdea);
      stats.duplicatePosts++;
    }

    if (accepted === null) {
      stats.failedPosts++;
      console.error('[TranscriptProcessing] Post generation failed', {
        transcriptId,
        postIndex,
      });
      continue;
    }

    acceptedPosts.push(accepted);

    console.log('[TranscriptProcessing] Post generated', {
      postIndex,
      postId: accepted.id,
      isDuplicate: accepted.isDuplicate,
      similarity: accepted.similarity,
      finalAttempt: accepted.attemptNumber,
    });
  }

  if (acceptedPosts.length > 0) {
    await markAsProcessed(transcriptId, new Date());
  }

  console.log('[TranscriptProcessing] Completed', {
    transcriptId,
    uniquePosts: stats.uniquePosts,
    duplicatePosts: stats.duplicatePosts,
    failedPosts: stats.failedPosts,
    totalAttempts: stats.totalAttempts,
  });

  return {
    transcriptId,
    posts: acceptedPosts,
    stats,
    errors,
  };
}
