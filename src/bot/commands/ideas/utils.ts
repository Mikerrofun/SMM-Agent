import type { IdeaModel } from '../../../db/generated/models/Idea';
import { escapeHtml } from '../../utils';

/**
 * Склонение слова «идея» по числу.
 */
export function pluralizeIdea(count: number): string {
  const lastDigit = count % 10;
  const lastTwoDigits = count % 100;

  if (lastTwoDigits >= 11 && lastTwoDigits <= 19) {
    return 'идей';
  }

  if (lastDigit === 1) {
    return 'идея';
  }

  if (lastDigit >= 2 && lastDigit <= 4) {
    return 'идеи';
  }

  return 'идей';
}

/**
 * Текст карточки идеи для отправки в Telegram (HTML).
 */
export function formatIdeaCard(idea: IdeaModel): string {
  return (
    `💡 <b>${escapeHtml(idea.title)}</b>\n\n` +
    `📝 <b>Идея:</b>\n${escapeHtml(idea.mainIdea)}\n\n` +
    `🎯 <b>Цель:</b>\n${escapeHtml(idea.goal)}`
  );
}

/**
 * Итоговая строка после отправки порции идей.
 */
export function formatBatchSummary(count: number): string {
  return `✅ Отправлено ${count} ${pluralizeIdea(count)}!`;
}
