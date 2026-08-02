import type { GeneratedIdeaSchema } from '../schemas/idea.schema';
import type { z } from 'zod';

export type GeneratedIdea = z.infer<typeof GeneratedIdeaSchema>;

export interface CreateIdeaInput {
  competitorPostId: string;
  title: string;
  mainIdea: string;
  goal: string;
}

export interface IdeaProcessItem {
  id: string;           // competitorPostId
  text: string;         // пост конкурента
}
