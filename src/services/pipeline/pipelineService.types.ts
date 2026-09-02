import type { CompetitorParseStatistics } from '../../shared/types/competitorPost.types';
import type { IdeaProcessStats } from '../idea/ideaProcessor.types';
import type { DeduplicationStats } from '../shared/deduplication.types';

export type PipelineStage = 'parsing' | 'ideas' | 'deduplication';

export type PipelineProgressCallback = (
  stage: PipelineStage,
  status: string
) => Promise<void>;


export interface PipelineResult {
  parsing: CompetitorParseStatistics;
  ideas: IdeaProcessStats;
  deduplication: DeduplicationStats;
  acceptedIdeasFromRun: number;
}

export interface PipelineCommandResult {
  success: boolean;
  data?: PipelineResult;
  error?: string;
}
