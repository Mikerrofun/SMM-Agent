/**
 * Оркестрация генерации постов из транскрипции.
 *
 * Цикл попыток (генерация → mainIdea → embedding → дедуп → SENT/DUPLICATE)
 * живёт в общем пайплайне src/services/shared/postGeneration/.
 * Здесь остаётся точка входа transcript-флоу: загрузка транскрипции,
 * markAsProcessed, stats.
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
  getRevealedMainIdeas,
  markAsDuplicate,
} from '../../repositories/transcriptPostRepository';
import { generateAndCheckEmbedding } from './deduplicationService';
import {
  generateUniquePost,
  generateAdditionalPostShared,
} from '../shared/postGeneration/postGenerationPipeline';
import type {
  PostGenerationDeps,
} from '../shared/postGeneration/postGeneration.types';
import { createPostGenerationStats } from '../shared/postGeneration/postGeneration.types';
import type { TranscriptPostData } from '../../shared/types/transcript.types';
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
import type { CreateTranscriptPostInput } from '../../shared/types/transcript.types';


function buildDeps(
  transcript: { id: string; text: string }
): PostGenerationDeps<TranscriptPostData, CreateTranscriptPostInput> {
  return {
    repository: {
      create: createTranscriptPost,
      updateEmbedding,
      updateSimilarity,
      updateStatus,
      markAsDuplicate,
    },
    config: {
      maxAttemptsPerPost: MAX_ATTEMPTS_PER_POST,
      retryConfig: AI_RETRY_CONFIG,
      targetSource: 'transcriptPost',
    },
    checkDuplication: (mainIdea) => generateAndCheckEmbedding(mainIdea, 'transcriptPost'),
    generateText: (usedMainIdeas) =>
      generatePostFromTranscript(transcript.text, usedMainIdeas),
    extractMainIdea,
    createInput: ({ text, mainIdea, attemptNumber }) => ({
      transcriptId: transcript.id,
      text,
      mainIdea,
      attemptNumber,
    }),
    logPrefix: '[TranscriptProcessing]',
    logContext: { transcriptId: transcript.id },
  };
}

async function generateSinglePost(
  transcript: { id: string; text: string },
  usedMainIdeas: string[],
  postIndex: number,
  stats: ProcessingStats,
  errors: string[]
): Promise<TranscriptPostData | null> {
  return generateUniquePost(
    buildDeps(transcript),
    usedMainIdeas,
    postIndex,
    stats,
    errors
  );
}

export async function processTranscript(
  transcriptId: string
): Promise<ProcessingResult> {
  console.log('[TranscriptProcessing] Starting', { transcriptId });

  const transcript = await getTranscriptById(transcriptId);

  if (!transcript) {
    throw new TranscriptNotFoundError(transcriptId);
  }

  const stats = createPostGenerationStats();

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
  try {
    const transcript = await getTranscriptById(transcriptId);

    if (!transcript) {
      return {
        success: false,
        reason: 'error',
        error: 'Транскрипция не найдена',
      };
    }

    return await generateAdditionalPostShared<TranscriptPostData>({
      getUsedMainIdeas: () => getRevealedMainIdeas(transcriptId),
      generateSingle: (usedMainIdeas, postIndex, stats, errors) =>
        generateSinglePost(
          { id: transcriptId, text: transcript.text },
          usedMainIdeas,
          postIndex,
          stats,
          errors
        ),
      logPrefix: '[TranscriptProcessing]',
      logContext: { transcriptId },
    });
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
