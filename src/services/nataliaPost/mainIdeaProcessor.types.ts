export interface ProcessableItem {
  id: string;
  text: string;
}

export interface FailedItem {
  id: string;
  error: string;
}

export interface ProcessStats {
  total: number;
  succeeded: number;
  failed: number;
  failedItems: FailedItem[];
}

export type ProgressCallback = (current: number, total: number) => void;

export interface ProcessOptions {
  /** Функция извлечения mainIdea. По умолчанию — реальный LLM-экстрактор. */
  extractor?: (text: string) => Promise<string>;
  /** Функция сохранения результата в БД. */
  save: (id: string, mainIdea: string) => Promise<void>;
  /** Вызывается после каждого обработанного элемента. */
  onProgress?: ProgressCallback;
}
