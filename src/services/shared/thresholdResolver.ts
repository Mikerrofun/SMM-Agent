/**
 * Утилита для определения порога similarity в зависимости от источника и цели проверки.
 */

import { DEDUPLICATION_THRESHOLDS } from './deduplication.config';
import type { DuplicateSource } from './deduplication.types';

/**
 * Возвращает порог similarity для пары источников.
 *
 * Правила:
 * - nataliaChannelPost против NataliaPost: 0.85 (тема наследуется из карты
 *   канала, схожесть с постами Натальи изначально выше)
 * - Проверка против NataliaPost (остальные флоу): 0.75
 * - Проверка Ideas ↔ TranscriptPosts: 0.80
 * - Проверка внутри одного типа (включая посты канала между собой): 0.75
 *
 * @param targetSource - источник проверяемого контента
 * @param checkAgainstSource - источник, против которого проверяем
 * @returns порог similarity (от 0 до 1)
 */
export function getThreshold(
  targetSource: DuplicateSource,
  checkAgainstSource: DuplicateSource
): number {
  if (
    targetSource === 'nataliaChannelPost' &&
    checkAgainstSource === 'nataliaPost'
  ) {
    return DEDUPLICATION_THRESHOLDS.nataliaChannelPostVsNataliaPost;
  }

  if (checkAgainstSource === 'nataliaPost') {
    return DEDUPLICATION_THRESHOLDS.nataliaPost;
  }

  if (checkAgainstSource === 'nataliaChannelPost') {
    return DEDUPLICATION_THRESHOLDS.nataliaChannelPost;
  }

  if (targetSource === 'idea' && checkAgainstSource === 'transcriptPost') {
    return DEDUPLICATION_THRESHOLDS.crossContent;
  }

  if (targetSource === 'transcriptPost' && checkAgainstSource === 'idea') {
    return DEDUPLICATION_THRESHOLDS.crossContent;
  }

  return DEDUPLICATION_THRESHOLDS.sameType;
}
