/**
 * Оркестрация генерации постов из транскрипции.
 *
 * Для каждого из POSTS_PER_TRANSCRIPT постов делаем до MAX_ATTEMPTS_PER_POST попыток:
 * генерация → mainIdea → embedding → проверка дублей.
 * Первая уникальная попытка принимается и проставляется status = SENT.
 * Если все попытки дали дубли — пост не генерируется (failedPosts++).
 */

import { extractMainIdea } from '../../ai/mainIdeaExtractor';
import { generatePostFromTranscript } from '../../ai/transcriptPostGenerator';
import {
  getTranscriptById,
  markAsProcessed,
} from '../../repositories/clientTranscriptRepository';
import {
  createTranscriptPost,
  updateEmbedding,
  updateSimilarity,
  updateStatus,
  getSentPosts,
  markAsDuplicate,
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


async function generateSinglePost(
  transcript: { id: string; text: string },
  usedMainIdeas: string[],
  postIndex: number,
  stats: ProcessingStats,
  errors: string[]
): Promise<TranscriptPostData | null> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_POST; attempt++) {
    stats.totalAttempts++;

    try {
      const postText = await withRetry(
        () => generatePostFromTranscript(transcript.text, usedMainIdeas),
        AI_RETRY_CONFIG
      );

      const mainIdea = await withRetry(
        () => extractMainIdea(postText),
        AI_RETRY_CONFIG
      );

      const post = await createTranscriptPost({
        transcriptId: transcript.id,
        text: postText,
        mainIdea,
        attemptNumber: attempt,
      });

      const dedupResult = await generateAndCheckEmbedding(mainIdea);

      await updateEmbedding(post.id, dedupResult.embedding);
      await updateSimilarity(post.id, dedupResult.maxSimilarity);

      console.log('[TranscriptProcessing] Attempt', {
        transcriptId: transcript.id,
        postIndex,
        attempt,
        similarity: Number(dedupResult.maxSimilarity.toFixed(4)),
        isDuplicate: dedupResult.isDuplicate,
        source: dedupResult.source,
        matchedId: dedupResult.matchedId,
      });

      if (!dedupResult.isDuplicate) {
        // Уникальный пост: проставляем статус SENT
        await updateStatus(post.id, 'SENT');

        const sentPost: TranscriptPostData = {
          ...post,
          status: 'SENT',
          similarity: dedupResult.maxSimilarity,
          duplicateOfType: null,
          duplicateOfId: null,
        };

        stats.uniquePosts++;
        return sentPost;
      }

      // Дубль: помечаем как DUPLICATE с информацией об источнике
      if (dedupResult.source && dedupResult.matchedId) {
        await markAsDuplicate(
          post.id,
          dedupResult.source,
          dedupResult.matchedId,
          dedupResult.maxSimilarity
        );
      }

      // Переходим к следующей попытке
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`post ${postIndex}, attempt ${attempt}: ${message}`);
      console.error('[TranscriptProcessing] Attempt failed', {
        transcriptId: transcript.id,
        postIndex,
        attempt,
        error: message,
      });
    }
  }

  stats.failedPosts++;
  return null;
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
  const postsToSend: TranscriptPostData[] = [];
  const usedMainIdeas: string[] = [];

  for (let postIndex = 1; postIndex <= POSTS_PER_TRANSCRIPT; postIndex++) {
    const postToSend = await generateSinglePost(
      { id: transcriptId, text: transcript.text },
      usedMainIdeas,
      postIndex,
      stats,
      errors
    );

    if (postToSend === null) {
      console.error('[TranscriptProcessing] Post generation failed', {
        transcriptId,
        postIndex,
        message: 'All attempts resulted in duplicates or errors',
      });
      continue;
    }

    postsToSend.push(postToSend);
    usedMainIdeas.push(postToSend.mainIdea);

    console.log('[TranscriptProcessing] Post generated', {
      postIndex,
      postId: postToSend.id,
      isDuplicate: false,
      similarity: postToSend.similarity,
      finalAttempt: postToSend.attemptNumber,
    });
  }

  if (postsToSend.length > 0) {
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
    requestedPosts: POSTS_PER_TRANSCRIPT,
    posts: postsToSend,
    stats,
    errors,
  };
}


export async function generateAdditionalPost(
  transcriptId: string
): Promise<{
  success: boolean;
  post?: TranscriptPostData;
  reason?: 'no_unique_topics' | 'error';
  error?: string;
}> {
  console.log('[TranscriptProcessing] Generating additional post', {
    transcriptId,
  });

  try {
    const transcript = await getTranscriptById(transcriptId);

    if (!transcript) {
      return {
        success: false,
        reason: 'error',
        error: 'Транскрипция не найдена',
      };
    }

    const sentPosts = await getSentPosts(transcriptId);
    const usedMainIdeas = sentPosts.map((p) => p.mainIdea);

    console.log('[TranscriptProcessing] Found sent posts', {
      transcriptId,
      sentPostsCount: sentPosts.length,
      usedMainIdeas: usedMainIdeas.length,
    });

    const stats: ProcessingStats = {
      totalAttempts: 0,
      uniquePosts: 0,
      duplicatePosts: 0,
      failedPosts: 0,
    };
    const errors: string[] = [];

    const post = await generateSinglePost(
      { id: transcriptId, text: transcript.text },
      usedMainIdeas,
      sentPosts.length + 1,
      stats,
      errors
    );

    if (post === null) {
      console.log('[TranscriptProcessing] No unique topics found', {
        transcriptId,
        totalAttempts: stats.totalAttempts,
      });

      return {
        success: false,
        reason: 'no_unique_topics',
      };
    }

    console.log('[TranscriptProcessing] Additional post generated', {
      transcriptId,
      postId: post.id,
      totalAttempts: stats.totalAttempts,
    });

    return {
      success: true,
      post,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[TranscriptProcessing] Additional post generation failed', {
      transcriptId,
      error: message,
    });

    return {
      success: false,
      reason: 'error',
      error: message,
    };
  }
}
