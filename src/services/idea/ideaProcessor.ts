import { extractIdea } from '../../ai/ideaExtractor';
import { createEmbedding } from '../../ai/embeddings';
import { createIdeaAndMarkProcessed } from '../../repositories/ideaRepository';
import { withRetry } from '../../shared/utils/retry';
import { sleep } from '../../shared/utils/sleep';
import { IDEA_RETRY_CONFIG, IDEA_RATE_LIMIT } from './idea.config';
import {
  IdeaExtractionError,
  EmbeddingGenerationError,
  IdeaSaveError,
  formatIdeaProcessError,
} from './errors';
import type {
  IdeaProcessOptions,
  IdeaProcessStats,
} from './ideaProcessor.types';
import type { IdeaProcessItem, IdeaProcessStage } from '../../shared/types/idea.types';

/**
 * Обрабатывает батч постов конкурентов с генерацией идей.
 *
 * Worker pool обеспечивает параллелизм (до concurrency одновременно),
 * при этом запросы к API стартуют с фиксированным интервалом
 * для соблюдения rate limit (requestsPerMinute).
 *
 * @param options — опции обработки (items, onProgress)
 * @returns статистика обработки (succeeded, failed, failedItems)
 */


export async function processIdeaBatch(
  options: IdeaProcessOptions
): Promise<IdeaProcessStats> {
  const { items, onProgress } = options;
  const { requestsPerMinute, concurrency } = IDEA_RATE_LIMIT;
  const intervalMs = Math.ceil(60_000 / requestsPerMinute);

  const stats: IdeaProcessStats = {
    total: items.length,
    succeeded: 0,
    failed: 0,
    failedItems: [],
  };

  let processed = 0;
  let nextIndex = 0;
  let lastStart = 0;

  async function processItem(item: IdeaProcessItem): Promise<void> {
    let stage: IdeaProcessStage = 'extractIdea';
    
    try {
      // ЭТАП 1: Генерация идеи через LLM
      stage = 'extractIdea';
      const idea = await withRetry(
        async () => {
          try {
            return await extractIdea(item.text);
          } catch (err) {
            throw new IdeaExtractionError(
              `Failed to extract idea from post ${item.id}`,
              err instanceof Error ? err : undefined
            );
          }
        },
        IDEA_RETRY_CONFIG
      );

      // ЭТАП 2: Генерация embedding от mainIdea
      stage = 'embedding';
      const embedding = await withRetry(
        async () => {
          try {
            return await createEmbedding(idea.mainIdea);
          } catch (err) {
            throw new EmbeddingGenerationError(
              `Failed to create embedding for idea from post ${item.id}`,
              err instanceof Error ? err : undefined
            );
          }
        },
        IDEA_RETRY_CONFIG
      );

      // ЭТАП 3: Сохранение в БД
      stage = 'save';
      try {
        await createIdeaAndMarkProcessed({
          competitorPostId: item.id,
          ...idea,
          embedding,
        });
      } catch (err) {
        throw new IdeaSaveError(
          `Failed to save idea for post ${item.id}`,
          err instanceof Error ? err : undefined
        );
      }

      stats.succeeded++;
    } catch (error) {
      stats.failed++;
      const errorMessage = formatIdeaProcessError(error, stage, item.id);
      console.error(`❌ Failed to process post ${item.id}: ${errorMessage}`);
      
      if (error instanceof Error && error.cause) {
        console.error(`   Caused by: ${error.cause.message}`);
      }
      
      stats.failedItems.push({
        id: item.id,
        stage,
        error: errorMessage,
      });
    } finally {
      processed++;
      onProgress?.(processed, items.length);
    }
  }

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const item = items[nextIndex++];

      const now = Date.now();
      const wait = lastStart + intervalMs - now;
      lastStart = wait > 0 ? now + wait : now;
      if (wait > 0) {
        await sleep(wait);
      }

      await processItem(item);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker()
  );

  await Promise.all(workers);

  return stats;
}
