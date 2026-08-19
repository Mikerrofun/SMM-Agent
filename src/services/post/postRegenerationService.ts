import { regeneratePost } from '../../ai/postRegenerator';
import { REGENERATE_RETRY_CONFIG } from '../../ai/postRegenerator.config';
import { extractMainIdea } from '../../ai/mainIdeaExtractor';

import {
  getGeneratedPostById,
  updateGeneratedPostText,
} from '../../repositories/generatedPostRepository';
import {
  getTranscriptPostById,
  updateTranscriptPostText,
} from '../../repositories/transcriptPostRepository';

import { withRetry } from '../../shared/utils/retry';

import type {
  PostType,
  PostRegenerationResult,
} from './postRegenerationService.types';

export async function regeneratePostUniversal(
  postId: string,
  postType: PostType,
  feedback?: string
): Promise<PostRegenerationResult> {
  try {
    const post =
      postType === 'generated'
        ? await getGeneratedPostById(postId)
        : await getTranscriptPostById(postId);
    
    if (!post) {
      throw new Error(
        `${postType === 'generated' ? 'GeneratedPost' : 'TranscriptPost'} with ID ${postId} not found`
      );
    }

    let mainIdea = post.mainIdea;

    if (postType === 'generated' && !mainIdea) {
      mainIdea = await withRetry(
        async () => await extractMainIdea(post.text),
        REGENERATE_RETRY_CONFIG
      );
    }

    const newText = await withRetry(
      async () => {
        return await regeneratePost({
          currentText: post.text,
          mainIdea: mainIdea!,
          feedback,
        });
      },
      REGENERATE_RETRY_CONFIG
    );

    if (postType === 'generated') {
      const shouldSaveMainIdea = !post.mainIdea;
      await updateGeneratedPostText(
        postId,
        newText,
        shouldSaveMainIdea ? (mainIdea as string) : undefined
      );
    } else {
      await updateTranscriptPostText(postId, newText);
    }

    return {
      success: true,
      postText: newText,
      postId,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error occurred';

    console.error(
      `Failed to regenerate ${postType} post ${postId}:`,
      error
    );

    return {
      success: false,
      error: errorMessage,
      postId,
    };
  }
}

export async function regenerateGeneratedPost(
  postId: string,
  feedback?: string
): Promise<PostRegenerationResult> {
  return regeneratePostUniversal(postId, 'generated', feedback);
}

export async function regenerateTranscriptPost(
  postId: string,
  feedback?: string
): Promise<PostRegenerationResult> {
  return regeneratePostUniversal(postId, 'transcript', feedback);
}
