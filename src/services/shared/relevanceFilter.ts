/**
 * Фильтр релевантности: отбраковка контента, слишком похожего на канал Натальи.
 *
 * Контент проверяется отдельно от дедупликации: если он не дубль
 * (не прошёл пороги DEDUPLICATION_THRESHOLDS), но nataliaSimilarity
 * ниже MIN_NATALIA_SIMILARITY — он отбраковывается с причиной
 * 'natalia_relevance' (duplicateOfId остаётся пустым).
 */

import { MIN_NATALIA_SIMILARITY } from './deduplication.config';
import type { RelevanceRejectionReason } from './deduplication.types';

/**
 * Определяет, нужно ли отбраковать контент по релевантности к каналу Натальи.
 *
 * @param nataliaSimilarity — максимальная схожесть с постами канала Натальи
 * @param isDuplicate — признак того, что контент уже является дублем
 * @returns true, если контент не дубль, но схожесть с каналом ниже порога
 */
export function isNataliaRelevanceRejected(
  nataliaSimilarity: number,
  isDuplicate: boolean
): boolean {
  return !isDuplicate && nataliaSimilarity < MIN_NATALIA_SIMILARITY;
}

/** Причина отбраковки по релевантности (для duplicateOfType). */
export const NATALIA_RELEVANCE_REASON: RelevanceRejectionReason = 'natalia_relevance';
