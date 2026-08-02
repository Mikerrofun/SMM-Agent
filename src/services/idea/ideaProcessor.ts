import { extractIdea } from '../../ai/ideaExtractor';
import { createIdeaAndMarkProcessed } from '../../repositories/ideaRepository';
import { withRetry } from '../../shared/utils/retry';
import { sleep } from '../../shared/utils/sleep';
import { IDEA_RETRY_CONFIG, IDEA_RATE_LIMIT } from './idea.config';
import type {
  IdeaProcessOptions,
  IdeaProcessStats,
} from './ideaProcessor.types';
import type { IdeaProcessItem } from '../../types/idea.types';

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
    try {
      const idea = await withRetry(
        () => extractIdea(item.text),
        IDEA_RETRY_CONFIG
      );

      await createIdeaAndMarkProcessed({
        competitorPostId: item.id,
        ...idea,
      });

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
