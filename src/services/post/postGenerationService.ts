/**
 * Сервис для генерации постов из идей.
 * 
 * Оркеструет весь процесс:
 * 1. Загрузка идеи с постом конкурента из БД
 * 2. Валидация данных
 * 3. Вызов AI для генерации поста (с retry)
 * 4. Сохранение результата в БД с обновлением статуса идеи
 */

import { generatePost } from '../../ai/postGenerator';
import { POST_RETRY_CONFIG } from '../../ai/postGenerator.config';
import {
  getIdeaWithCompetitorPost,
  createGeneratedPost,
  getGeneratedPostByIdeaId,
  deleteGeneratedPostAndResetIdea,
} from '../../repositories/generatedPostRepository';
import { withRetry } from '../../shared/utils/retry';
import { PostGenerationError } from './postGenerationService.errors';
import type { PostGenerationResult } from './postGenerationService.types';


export async function generatePostForIdea(
  ideaId: string
): Promise<PostGenerationResult> {
  try {
    // Этап 1: Загрузка идеи с присоединённым постом конкурента
    const idea = await getIdeaWithCompetitorPost(ideaId);

    if (!idea) {
      throw new PostGenerationError(`Idea with ID ${ideaId} not found`);
    }

    // Этап 2: Валидация данных
    if (idea.status === 'SELECTED') {
      const existingPost = await getGeneratedPostByIdeaId(ideaId);
      if (existingPost) {
        return {
          success: true,
          postText: existingPost.text,
          ideaId: idea.id,
        };
      }
    }

    if (idea.status !== 'SENT') {
      throw new PostGenerationError(
        `Cannot generate post for idea ${ideaId}: status must be SENT, but got ${idea.status}`
      );
    }

    if (!idea.competitorPost) {
      throw new PostGenerationError(
        `Idea ${ideaId} has no associated competitor post`
      );
    }

    if (!idea.competitorPost.text || idea.competitorPost.text.trim().length === 0) {
      throw new PostGenerationError(
        `Competitor post for idea ${ideaId} has empty text`
      );
    }

    // Этап 3: Генерация поста через AI с retry
    const postText = await withRetry(
      async () => {
        return await generatePost({
          idea: {
            title: idea.title,
            mainIdea: idea.mainIdea,
            goal: idea.goal,
          },
          competitorPostText: idea.competitorPost!.text,
        });
      },
      POST_RETRY_CONFIG
    );

    // Этап 4: Сохранение в БД с обновлением статуса идеи
    await createGeneratedPost({
      ideaId: idea.id,
      text: postText,
    });

    return {
      success: true,
      postText,
      ideaId: idea.id,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error occurred';

    console.error(`Failed to generate post for idea ${ideaId}:`, error);

    return {
      success: false,
      error: errorMessage,
      ideaId,
    };
  }
}

/**
 * Перегенерирует пост для идеи.
 * Удаляет существующий пост и генерирует новый.
 * 
 * @param ideaId — ID идеи для регенерации поста
 * @returns результат генерации с новым текстом поста или ошибкой
 */
export async function regeneratePostForIdea(
  ideaId: string
): Promise<PostGenerationResult> {
  try {
    // Удаляем существующий пост и возвращаем статус идеи на SENT
    const wasDeleted = await deleteGeneratedPostAndResetIdea(ideaId);

    if (!wasDeleted) {
      console.warn(
        `No existing post found for idea ${ideaId}, proceeding with generation`
      );
    }

    // Генерируем новый пост
    return await generatePostForIdea(ideaId);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error occurred';

    console.error(`Failed to regenerate post for idea ${ideaId}:`, error);

    return {
      success: false,
      error: errorMessage,
      ideaId,
    };
  }
}
