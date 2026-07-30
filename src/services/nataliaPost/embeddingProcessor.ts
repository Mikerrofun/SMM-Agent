import { createEmbedding } from "../../ai/embeddings";

export interface EmbeddingItem {
  id: string;
  text: string; // mainIdea для векторизации
}

export interface EmbeddingProcessOptions {
  items: EmbeddingItem[];
  saveEmbedding: (id: string, embedding: number[]) => Promise<void>;
  onProgress?: (processed: number, total: number) => void;
}

export interface EmbeddingProcessStats {
  total: number;
  succeeded: number;
  failed: number;
  failedItems: Array<{ id: string; error: string }>;
}

/**
 * Генерирует embeddings для массива элементов без rate-limiting.
 * Обрабатывает параллельно (concurrency = 10).
 */
export async function processEmbeddingsBatch(
  options: EmbeddingProcessOptions
): Promise<EmbeddingProcessStats> {
  const { items, saveEmbedding, onProgress } = options;
  const CONCURRENCY = 10;

  const stats: EmbeddingProcessStats = {
    total: items.length,
    succeeded: 0,
    failed: 0,
    failedItems: [],
  };

  let processed = 0;
  let nextIndex = 0;

  async function processItem(item: EmbeddingItem): Promise<void> {
    try {
      const embedding = await createEmbedding(item.text);
      await saveEmbedding(item.id, embedding);
      stats.succeeded++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      stats.failed++;
      stats.failedItems.push({ id: item.id, error: message });
    } finally {
      processed++;
      onProgress?.(processed, items.length);
    }
  }

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const item = items[nextIndex++];
      await processItem(item);
    }
  }

  const workers = Array.from(
    { length: Math.min(CONCURRENCY, items.length) },
    () => worker()
  );

  await Promise.all(workers);

  return stats;
}
