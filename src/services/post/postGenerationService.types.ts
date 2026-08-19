export interface PostGenerationSuccess {
  success: true;
  postText: string;
  ideaId: string;
  postId: string;
}

export interface PostGenerationError {
  success: false;
  error: string;
  ideaId: string;
}

export type PostGenerationResult = PostGenerationSuccess | PostGenerationError;
