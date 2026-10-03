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

/**
 * Сохраняет состояние ожидания выбора категории.
 */
export function saveSelection(userId: number): void {
  selectionStates.set(userId, { createdAt: new Date() });
}

/**
 * Синхронно забирает состояние выбора: читает и удаляет запись.
 * Возвращает null, если состояния нет (TTL истёк или его уже забрали).
 *
 * Синхронность важна: удаление происходит до первого await, поэтому два
 * параллельных нажатия не пройдут дальше.
 */
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

/**
 * Снимает состояние выбора (страховка, если флоу упал до забора состояния).
 */
export function clearSelection(userId: number): void {
  selectionStates.delete(userId);
}

/**
 * Идёт ли сейчас рассылка у пользователя.
 */
export function isSending(userId: number): boolean {
  return sendingUserIds.has(userId);
}

/**
 * Помечает, что рассылка запущена.
 * @returns false, если рассылка уже идёт
 */
export function startSending(userId: number): boolean {
  if (sendingUserIds.has(userId)) {
    return false;
  }

  sendingUserIds.add(userId);
  return true;
}

/**
 * Снимает флаг «рассылка идёт».
 */
export function finishSending(userId: number): void {
  sendingUserIds.delete(userId);
}
