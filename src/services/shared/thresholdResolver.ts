/**
 * Утилита для определения порога similarity в зависимости от источника и цели проверки.
 */

import { DEDUPLICATION_THRESHOLDS } from './deduplication.config';
import type { DuplicateSource } from './deduplication.types';

/**
 * Возвращает порог similarity для пары источников.
 * 
 * Правила:
 * - Проверка против NataliaPost: 0.75
 * - Проверка Ideas ↔ TranscriptPosts: 0.82
 * - Проверка внутри одного типа: 0.75
 * 
 * @param targetSource - источник проверяемого контента
 * @param checkAgainstSource - источник, против которого проверяем
 * @returns порог similarity (от 0 до 1)
 */
export function getThreshold(
  targetSource: DuplicateSource,
  checkAgainstSource: DuplicateSource
): number {
  // Проверка против постов Натальи
  if (checkAgainstSource === 'nataliaPost') {
    return DEDUPLICATION_THRESHOLDS.nataliaPost;
  }

  // Проверка Ideas против TranscriptPosts
  if (targetSource === 'idea' && checkAgainstSource === 'transcriptPost') {
    return DEDUPLICATION_THRESHOLDS.crossContent;
  }

  // Проверка TranscriptPosts против Ideas
  if (targetSource === 'transcriptPost' && checkAgainstSource === 'idea') {
    return DEDUPLICATION_THRESHOLDS.crossContent;
  }

  // Проверка внутри одного типа (или любой другой случай)
  return DEDUPLICATION_THRESHOLDS.sameType;
}
