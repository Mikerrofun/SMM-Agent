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
    const idea = await getIdeaWithCompetitorPost(ideaId);

    if (!idea) {
      throw new PostGenerationError(`Idea with ID ${ideaId} not found`);
    }

    if (idea.status === 'SELECTED') {
      const existingPost = await getGeneratedPostByIdeaId(ideaId);
      if (existingPost) {
        return {
          success: true,
          postText: existingPost.text,
          ideaId: idea.id,
          postId: existingPost.id,
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

    const createdPost = await createGeneratedPost({
      ideaId: idea.id,
      text: postText,
    });

    return {
      success: true,
      postText,
      ideaId: idea.id,
      postId: createdPost.id,
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

export async function regeneratePostForIdea(
  ideaId: string
): Promise<PostGenerationResult> {
  try {
    const wasDeleted = await deleteGeneratedPostAndResetIdea(ideaId);

    if (!wasDeleted) {
      console.warn(
        `No existing post found for idea ${ideaId}, proceeding with generation`
      );
    }

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
