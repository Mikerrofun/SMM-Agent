export type PostType = 'generated' | 'transcript';

export interface WaitingForFeedbackState {
  postId: string;
  postType: PostType;
  originalMessageId: number;
}

export interface PostRegenerationSuccess {
  success: true;
  postText: string;
  postId: string;
}


export interface PostRegenerationFailure {
  success: false;
  error: string;
  postId: string;
}

export type PostRegenerationResult =
  | PostRegenerationSuccess
  | PostRegenerationFailure;
