import type { GeneratedIdeaSchema } from '../../schemas/idea.schema';
import type { z } from 'zod';

export type GeneratedIdea = z.infer<typeof GeneratedIdeaSchema>;

// Типы для обработки идей
export type IdeaProcessStage = 'extractIdea' | 'embedding' | 'save';
export type IdeaStatus = 'NEW' | 'SENT' | 'SELECTED' | 'REJECTED' | 'DUPLICATE';

export const IDEA_PROCESS_STAGES: IdeaProcessStage[] = ['extractIdea', 'embedding', 'save'];
export const IDEA_STATUSES: IdeaStatus[] = ['NEW', 'SENT', 'SELECTED', 'REJECTED', 'DUPLICATE'];

export interface CreateIdeaInput {
  competitorPostId: string;
  title: string;
  mainIdea: string;
  goal: string;
  embedding: number[]; 
}

export interface IdeaProcessItem {
  id: string;           // competitorPostId
  text: string;         // пост конкурента
}
