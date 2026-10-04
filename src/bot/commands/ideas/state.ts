/**
 * Состояние флоу выбора категории идей.
 *
 * Два независимых набора:
 * - selectionStates — пользователь получил клавиатуру выбора и ещё не нажал кнопку;
 *   состояние одноразовое, забирается синхронно (takeSelection), поэтому двойное
 *   нажатие не запускает две рассылки;
 * - sendingUserIds — рассылка уже выполняется (защита от повторного нажатия).
 *
 * TTL проверяется лениво при чтении и записи, поэтому отдельный таймер не нужен.
 */

import type { IdeasSelectionState } from './ideas.types';
import { SELECTION_TTL_MS } from './config';

const selectionStates = new Map<number, IdeasSelectionState>();
const sendingUserIds = new Set<number>();

function isExpired(state: IdeasSelectionState, now: number): boolean {
  return now - state.createdAt.getTime() > SELECTION_TTL_MS;
}

export function saveSelection(userId: number): void {
  selectionStates.set(userId, { createdAt: new Date() });
}

export function takeSelection(userId: number): IdeasSelectionState | null {
  const state = selectionStates.get(userId);

  if (!state) {
    return null;
  }

  selectionStates.delete(userId);

  if (isExpired(state, Date.now())) {
    return null;
  }

  return state;
}

export function clearSelection(userId: number): void {
  selectionStates.delete(userId);
}

export function isSending(userId: number): boolean {
  return sendingUserIds.has(userId);
}

export function startSending(userId: number): boolean {
  if (sendingUserIds.has(userId)) {
    return false;
  }

  sendingUserIds.add(userId);
  return true;
}

export function finishSending(userId: number): void {
  sendingUserIds.delete(userId);
}
