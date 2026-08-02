import { z } from 'zod';

export const GeneratedIdeaSchema = z.object({
  title: z.string()
    .min(10, 'Title too short')
    .max(60, 'Title max 60 chars'),
  mainIdea: z.string()
    .min(50, 'MainIdea too short')
    .max(500, 'MainIdea too long'),
  goal: z.string()
    .min(20, 'Goal too short')
    .max(200, 'Goal too long'),
});

export const IdeaJsonSchema = {
  type: 'object',
  properties: {
    title: { type: 'string', maxLength: 60 },
    mainIdea: { type: 'string' },
    goal: { type: 'string' },
  },
  required: ['title', 'mainIdea', 'goal'],
  additionalProperties: false,
} as const;
