import type { IdeaProcessItem, IdeaProcessStage } from '../../shared/types/idea.types';

export interface IdeaProcessOptions {
  items: IdeaProcessItem[];
  onProgress?: (current: number, total: number) => void;
}

export interface FailedItem {
  id: string;
  stage: IdeaProcessStage; // Stage where the error occurred
  error: string;
}

export interface IdeaProcessStats {
  total: number;
  succeeded: number;
  failed: number;
  failedItems: FailedItem[];
}
