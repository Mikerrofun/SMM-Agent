import { extractMainIdea } from "../../ai/mainIdeaExtractor";
import { withRetry } from "../../shared/utils/retry";
import { sleep } from "../../shared/utils/sleep";
import { MAIN_IDEA_RETRY_CONFIG, MAIN_IDEA_RATE_LIMIT } from "./mainIdea.config";
import type {
  ProcessableItem,
  ProcessOptions,
  ProcessStats,
} from "./mainIdeaProcessor.types";

/**
 * Обрабатывает элементы с равномерным темпом (paced), чтобы не превышать
 * rate limit LLM (30 req/min → иначе 429). Запросы стартуют с фиксированным
 * интервалом 60000 / requestsPerMinute, а не пачками. Параллельность
 * ограничена concurrency. Каждый запрос — с retry (экспоненциальный backoff).
 * Универсален: принимает функции extractor и save.
 */
export async function processBatch(
  items: ProcessableItem[],
  options: ProcessOptions
): Promise<ProcessStats> {
  const { extractor = extractMainIdea, save, onProgress } = options;
  const { requestsPerMinute, concurrency } = MAIN_IDEA_RATE_LIMIT;
  const intervalMs = Math.ceil(60_000 / requestsPerMinute);

  const stats: ProcessStats = {
    total: items.length,
    succeeded: 0,
    failed: 0,
    failedItems: [],
  };

  let processed = 0;
  let nextIndex = 0;
  let lastStart = 0;

  async function processItem(item: ProcessableItem): Promise<void> {
    try {
      const mainIdea = await withRetry(
        () => extractor(item.text),
        MAIN_IDEA_RETRY_CONFIG
      );
      await save(item.id, mainIdea);
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

  // Воркеры разбирают очередь, но старт каждого запроса «пропускается»
  // через общий интервал — так держим стабильные req/min.
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
