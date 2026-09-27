/**
 * Оркестрация генерации постов из главных идей канала Натальи
 * (команда /natalia_channel_post).
 *
 * Цикл попыток и дедупликация живут в общем пайплайне
 * src/services/shared/postGeneration/ (Задача 5 рефакторинга nataliaPostsGen).
 * Источник контента — все mainIdea из NataliaPost, собираемые одним запросом
 * при каждом вызове генерации (данные всегда свежие).
 */

import crypto from 'crypto';
import { extractMainIdea } from '../../ai/mainIdeaExtractor';
import { generateNataliaChannelPost } from '../../ai/nataliaChannelPostGenerator';
import { getAllMainIdeas } from '../../repositories/nataliaPostRepository';
import {
  createNataliaChannelPost,
  updateEmbedding,
  updateSimilarity,
  updateStatus,
  markAsDuplicate,
  getRevealedMainIdeas,
  revertBatchPostsToDraft,
} from '../../repositories/nataliaChannelPostRepository';
import { generateAndCheckEmbedding } from '../transcript/deduplicationService';
import { checkCancelled } from '../../shared/utils/CommandManager/CommandManager';
import { CommandCancelledError } from '../../shared/utils/CommandManager/CommandManager.errors';
import { buildNataliaChannelContext } from '../shared/postGeneration/nataliaChannelContext';
import {
  generateUniquePost,
  generateAdditionalPostShared,
} from '../shared/postGeneration/postGenerationPipeline';
import type {
  PostGenerationDeps,
} from '../shared/postGeneration/postGeneration.types';
import { createPostGenerationStats } from '../shared/postGeneration/postGeneration.types';
import type {
  CreateNataliaChannelPostInput,
  NataliaChannelPostData,
} from '../../shared/types/nataliaChannelPost.types';
import type { NataliaChannelProcessingResult } from './nataliaChannelPost.types';
import {
  AI_RETRY_CONFIG,
  MAX_ATTEMPTS_PER_POST,
  POSTS_PER_RUN,
} from './nataliaChannelPost.config';

function buildDeps(batchId: string): PostGenerationDeps<
  NataliaChannelPostData,
  CreateNataliaChannelPostInput
> {
  return {
    repository: {
      create: createNataliaChannelPost,
      updateEmbedding,
      updateSimilarity,
      updateStatus,
      markAsDuplicate,
    },
    config: {
      maxAttemptsPerPost: MAX_ATTEMPTS_PER_POST,
      retryConfig: AI_RETRY_CONFIG,
      targetSource: 'nataliaChannelPost',
    },
    checkDuplication: (mainIdea) =>
      generateAndCheckEmbedding(mainIdea, 'nataliaChannelPost'),
    generateText: async (usedMainIdeas) => {
      // Свежая тематическая карта канала при каждом вызове генерации
      const mainIdeas = await getAllMainIdeas();
      const channelContext = buildNataliaChannelContext(mainIdeas);
      return generateNataliaChannelPost(channelContext, usedMainIdeas);
    },
    extractMainIdea,
    createInput: ({ text, mainIdea, attemptNumber }) => ({
      text,
      mainIdea,
      attemptNumber,
      generationBatchId: batchId,
    }),
    logPrefix: '[NataliaChannelPost]',
  };
}

export async function processNataliaChannelPosts(): Promise<NataliaChannelProcessingResult> {
  console.log('[NataliaChannelPost] Starting');

  // Генерируем UUID для группировки постов этой генерации
  const batchId = crypto.randomUUID();

  const stats = createPostGenerationStats();
  const errors: string[] = [];
  const postsToSend: NataliaChannelPostData[] = [];
  const usedMainIdeas: string[] = [];

  try {
    for (let postIndex = 1; postIndex <= POSTS_PER_RUN; postIndex++) {
      // Отмена до старта генерации следующего поста
      checkCancelled();

      const postToSend = await generateUniquePost(
        buildDeps(batchId),
        usedMainIdeas,
        postIndex,
        stats,
        errors
      );

      if (postToSend === null) {
        console.error('[NataliaChannelPost] Post generation failed', {
          postIndex,
          batchId,
          message:
            'All attempts resulted in duplicates, relevance rejections or errors',
        });
        continue;
      }

      postsToSend.push(postToSend);
      usedMainIdeas.push(postToSend.mainIdea);

      console.log('[NataliaChannelPost] Post generated', {
        postIndex,
        postId: postToSend.id,
        batchId,
        isDuplicate: false,
        similarity: postToSend.similarity,
        finalAttempt: postToSend.attemptNumber,
      });
    }

    console.log('[NataliaChannelPost] Completed', {
      batchId,
      uniquePosts: stats.uniquePosts,
      duplicatePosts: stats.duplicatePosts,
      failedPosts: stats.failedPosts,
      totalAttempts: stats.totalAttempts,
    });

    return {
      requestedPosts: POSTS_PER_RUN,
      posts: postsToSend,
      stats,
      errors,
    };
  } catch (error) {
    if (error instanceof CommandCancelledError) {
      // Откатываем все SENT посты этого batch обратно в REJECTED
      const reverted = await revertBatchPostsToDraft(batchId);
      
      console.log('[NataliaChannelPost] Cancelled, reverted batch SENT posts to REJECTED', {
        batchId,
        revertedCount: reverted,
      });
      
      throw error;
    }
    
    throw error;
  }
}

export async function generateAdditionalNataliaChannelPost(): Promise<{
  success: boolean;
  post?: NataliaChannelPostData;
  reason?: 'no_unique_topics' | 'error';
  error?: string;
}> {
  // Для дополнительного поста тоже нужен свой batchId
  const batchId = crypto.randomUUID();
  
  return generateAdditionalPostShared<NataliaChannelPostData>({
    getUsedMainIdeas: getRevealedMainIdeas,
    generateSingle: (usedMainIdeas, postIndex, stats, errors) =>
      generateUniquePost(buildDeps(batchId), usedMainIdeas, postIndex, stats, errors),
    logPrefix: '[NataliaChannelPost]',
  });
}
