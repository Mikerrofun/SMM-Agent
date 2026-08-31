import type { SimilaritySource, ResolvedSimilarity } from './similarityResolver.types';
import type { DuplicateSource } from './deduplication.types';
import { getThreshold } from './thresholdResolver';

/**
 * Находит лучшее совпадение среди нескольких источников с учетом дифференцированных порогов.
 * 
 * @param targetSource - источник проверяемого контента
 * @param sources - массив источников с результатами поиска (matches отсортированы по similarity DESC)
 * @returns максимальная similarity, источник и ID совпадения
 */
export function resolveBestMatch(
  targetSource: DuplicateSource,
  sources: Array<SimilaritySource>
): ResolvedSimilarity {
  let maxSimilarity = 0;
  let source: DuplicateSource | null = null;
  let matchedId: string | null = null;

  for (const candidate of sources) {
    const best = candidate.matches[0];

    if (!best) {
      continue;
    }

    // Получить порог для данной пары источников
    const threshold = getThreshold(targetSource, candidate.source);

    // Проверить, что similarity превышает порог
    if (best.similarity >= threshold && best.similarity > maxSimilarity) {
      maxSimilarity = best.similarity;
      source = candidate.source;
      matchedId = best.id;
    }
  }

  return { maxSimilarity, source, matchedId };
}

