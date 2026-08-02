import type { IdeaProcessItem } from '../../types/idea.types';

export interface IdeaProcessOptions {
  items: IdeaProcessItem[];
  onProgress?: (current: number, total: number) => void;
}

export interface FailedItem {
  id: string;
  error: string;
}

export interface IdeaProcessStats {
  total: number;
  succeeded: number;
  failed: number;
  failedItems: FailedItem[];
}
