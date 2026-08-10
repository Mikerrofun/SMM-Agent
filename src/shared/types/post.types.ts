export interface GeneratePostInput {
  idea: {
    title: string;
    mainIdea: string;
    goal: string;
  };
  competitorPostText: string;
}

export interface IdeaWithCompetitorPost {
  id: string;
  competitorPostId: string;
  title: string;
  mainIdea: string;
  goal: string;
  status: string;
  createdAt: Date;
  competitorPost: {
    id: string;
    text: string;
    telegramPostUrl: string;
    publishedAt: Date;
  } | null;
}

/**
 * Результат генерации поста
 */
export interface GeneratedPostResult {
  text: string;
  ideaId: string;
  ideaMessageId?: number; // Telegram message ID для reply
}
