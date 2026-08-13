/**
 * Выбор лучшего совпадения из нескольких источников.
 *
 * Общая часть дедупликации: и services/idea, и services/transcript сравнивают
 * вектор с несколькими наборами кандидатов (Idea / TranscriptPost / NataliaPost)
 * и берут максимальную similarity вместе с источником, откуда она пришла.
 */

import type { SimilarityMatch } from '../idea/deduplication.types';

/** Один источник кандидатов: имя источника + его совпадения (отсортированы DESC). */
export interface SimilaritySource<TSource extends string> {
  source: TSource;
  matches: SimilarityMatch[];
}

export interface ResolvedSimilarity<TSource extends string> {
  /** Максимальная similarity среди всех источников (0, если совпадений нет). */
  maxSimilarity: number;
  /** Источник лучшего совпадения. */
  source: TSource | null;
  /** id лучшего совпадения. */
  matchedId: string | null;
}

/**
 * Возвращает лучшее совпадение среди переданных источников.
 *
 * Источники сравниваются по первому элементу matches — репозитории уже
 * отдают результаты, отсортированные по similarity DESC.
 * При равной similarity выигрывает источник, идущий раньше в массиве.
 */
export function resolveBestMatch<TSource extends string>(
  sources: Array<SimilaritySource<TSource>>
): ResolvedSimilarity<TSource> {
  let maxSimilarity = 0;
  let source: TSource | null = null;
  let matchedId: string | null = null;

  for (const candidate of sources) {
    const best = candidate.matches[0];

    if (best && best.similarity > maxSimilarity) {
      maxSimilarity = best.similarity;
      source = candidate.source;
      matchedId = best.id;
    }
  }

  return { maxSimilarity, source, matchedId };
}
