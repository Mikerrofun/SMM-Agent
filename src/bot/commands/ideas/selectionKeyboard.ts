/**
 * Единая точка формата callback_data для кнопок выбора категории идей:
 * и сборка клавиатуры, и разбор входящих данных.
 * Так формат не может разъехаться между отправкой и приёмом.
 */

import { InlineKeyboard } from 'grammy';
import type { IdeasSelectionMode } from './ideas.types';
import {
  IDEAS_SELECTION_CALLBACK_PREFIX,
  RUN_PIPELINE_BUTTON_TEXT,
  RUN_PIPELINE_CALLBACK,
  SELECTION_BUTTONS,
} from './config';

export { IDEAS_SELECTION_CALLBACK_PREFIX, RUN_PIPELINE_CALLBACK };

export function buildIdeasSelectionKeyboard(): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  for (const button of SELECTION_BUTTONS) {
    keyboard.text(button.text, `${IDEAS_SELECTION_CALLBACK_PREFIX}${button.mode}`).row();
  }

  return keyboard;
}

/**
 * Клавиатура с единственной кнопкой «Запустить генерацию».
 * Используется, когда порция идей пуста.
 */
export function buildRunPipelineKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text(
    RUN_PIPELINE_BUTTON_TEXT,
    RUN_PIPELINE_CALLBACK
  );
}

/**
 * Разбирает callback_data вида `ideas_select:<mode>`.
 * @returns режим или null, если данные не относятся к выбору категории
 */
export function parseIdeasSelectionCallbackData(
  data: string | undefined
): IdeasSelectionMode | null {
  if (!data || !data.startsWith(IDEAS_SELECTION_CALLBACK_PREFIX)) {
    return null;
  }

  const mode = data.slice(IDEAS_SELECTION_CALLBACK_PREFIX.length);

  const isKnownMode = SELECTION_BUTTONS.some((button) => button.mode === mode);
  return isKnownMode ? (mode as IdeasSelectionMode) : null;
}
