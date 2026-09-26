/**
 * Общий пайплайн генерации постов с дедупликацией.
 *
 * Выделен из transcriptProcessingService.generateSinglePost (Задача 5 рефакторинга
 * nataliaPostsGen). Потребители: transcript_post и natalia_channel_post.
 *
 * Цикл попыток: генерация → extractMainIdea → сохранение → embedding + дедуп →
 * SENT, либо markAsDuplicate (дубль или 'natalia_relevance') → mainIdea попытки
 * уходит в usedMainIdeas («уже раскрытые темы») → следующая попытка.
 * Исчерпание попыток → null.
 */

import { withRetry } from '../../../shared/utils/retry';
import { checkCancelled } from '../../../shared/utils/CommandManager/CommandManager';
import { CommandCancelledError } from '../../../shared/utils/CommandManager/CommandManager.errors';
import { NATALIA_RELEVANCE_REASON } from '../relevanceFilter';
import type {
  AdditionalPostDeps,
  AdditionalPostResult,
  GeneratedPostBase,
  PostGenerationDeps,
  PostGenerationStats,
} from './postGeneration.types';
import { createPostGenerationStats } from './postGeneration.types';

export async function generateUniquePost<
  TPost extends GeneratedPostBase,
  TCreateInput,
>(
  deps: PostGenerationDeps<TPost, TCreateInput>,
  usedMainIdeas: string[],
  postIndex: number,
  stats: PostGenerationStats,
  errors: string[]
): Promise<TPost | null> {
  const { repository, config, logPrefix, logContext } = deps;

  for (let attempt = 1; attempt <= config.maxAttemptsPerPost; attempt++) {
    stats.totalAttempts++;

    try {
      // Отмена до LLM-генерации (проверки внутри withRetry не ставим —
      // отмена не должна ретраиться)
      checkCancelled();

      const postText = await withRetry(
        () => deps.generateText(usedMainIdeas),
        config.retryConfig
      );

      checkCancelled();

      const mainIdea = await withRetry(
        () => deps.extractMainIdea(postText),
        config.retryConfig
      );

      // checkCancelled строго до записи — после старта записи отмены нет
      checkCancelled();

      const post = await repository.create(
        deps.createInput({ text: postText, mainIdea, attemptNumber: attempt })
      );

      const dedupResult = await deps.checkDuplication(mainIdea);

      await repository.updateEmbedding(post.id, dedupResult.embedding);
      await repository.updateSimilarity(post.id, dedupResult.maxSimilarity);

      console.log(`${logPrefix} Attempt`, {
        ...logContext,
        postIndex,
        attempt,
        similarity: Number(dedupResult.maxSimilarity.toFixed(4)),
        nataliaSimilarity: Number(dedupResult.nataliaSimilarity.toFixed(4)),
        isDuplicate: dedupResult.isDuplicate,
        relevanceRejected: dedupResult.relevanceRejected,
        source: dedupResult.source,
        matchedId: dedupResult.matchedId,
      });

      if (!dedupResult.isDuplicate && !dedupResult.relevanceRejected) {
        // Уникальный пост: проставляем статус SENT
        // (точка невозврата — до неё отменяться можно)
        checkCancelled();
        await repository.updateStatus(post.id, 'SENT');

        const sentPost = {
          ...post,
          status: 'SENT',
          similarity: dedupResult.maxSimilarity,
          duplicateOfType: null,
          duplicateOfId: null,
        } as TPost;

        stats.uniquePosts++;
        return sentPost;
      }

      if (dedupResult.relevanceRejected) {
        // Не дубль, но слишком не похож на канал Натальи — отбраковка по релевантности
        await repository.markAsDuplicate(
          post.id,
          NATALIA_RELEVANCE_REASON,
          '',
          dedupResult.nataliaSimilarity
        );
      } else if (dedupResult.source && dedupResult.matchedId) {
        // Дубль: помечаем как DUPLICATE с информацией об источнике
        await repository.markAsDuplicate(
          post.id,
          dedupResult.source,
          dedupResult.matchedId,
          dedupResult.maxSimilarity
        );
      }

      // Отклонённая тема уже раскрыта (дубль или слишком близка к каналу):
      // уходит в «УЖЕ РАСКРЫТЫЕ ТЕМЫ», иначе следующая попытка
      // с высокой вероятностью генерирует её же снова
      usedMainIdeas.push(mainIdea);

    } catch (error) {
      // Отмена не считается неудачной попыткой — прокидываем вверх
      if (error instanceof CommandCancelledError) {
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);
      errors.push(`post ${postIndex}, attempt ${attempt}: ${message}`);
      console.error(`${logPrefix} Attempt failed`, {
        ...logContext,
        postIndex,
        attempt,
        error: message,
      });
    }
  }

  stats.failedPosts++;
  return null;
}

/**
 * Логика кнопки «ещё»: взять SENT-посты → usedMainIdeas → одна генерация →
 * 'no_unique_topics' при исчерпании.
 */
export async function generateAdditionalPostShared<TPost extends GeneratedPostBase>(
  deps: AdditionalPostDeps<TPost>
): Promise<AdditionalPostResult<TPost>> {
  const { logPrefix, logContext } = deps;

  console.log(`${logPrefix} Generating additional post`, logContext);

  try {
    const usedMainIdeas = await deps.getUsedMainIdeas();

    console.log(`${logPrefix} Found sent posts`, {
      ...logContext,
      usedMainIdeas: usedMainIdeas.length,
    });

    const stats = createPostGenerationStats();
    const errors: string[] = [];

    const post = await deps.generateSingle(
      usedMainIdeas,
      usedMainIdeas.length + 1,
      stats,
      errors
    );

    if (post === null) {
      console.log(`${logPrefix} No unique topics found`, {
        ...logContext,
        totalAttempts: stats.totalAttempts,
      });

      return {
        success: false,
        reason: 'no_unique_topics',
      };
    }

    console.log(`${logPrefix} Additional post generated`, {
      ...logContext,
      postId: post.id,
      totalAttempts: stats.totalAttempts,
    });

    return {
      success: true,
      post,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${logPrefix} Additional post generation failed`, {
      ...logContext,
      error: message,
    });

    return {
      success: false,
      reason: 'error',
      error: message,
    };
  }
}
