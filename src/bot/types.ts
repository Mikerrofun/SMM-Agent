/**
 * Типы для Telegram бота
 */

export interface IdeaDTO {
  id: string;
  title: string;
  thesis: string;
  goal: string;
  createdAt: Date;
}

export interface PostDTO {
  id: string;
  content: string;
  ideaId: string;
  createdAt: Date;
}

export interface BotContext {
  userId: number;
  username?: string;
  firstName?: string;
  lastName?: string;
}
