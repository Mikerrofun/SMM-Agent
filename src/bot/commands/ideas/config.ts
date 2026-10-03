import type { IdeasSelectionMode } from './ideas.types';

// Сколько идей отправляем за одну выборку
export const IDEAS_BATCH_SIZE = 10;

// Пауза между отправками, чтобы не упереться в rate limit Telegram
// (10 идей × N подписчиков за один вызов)
export const DELAY_BETWEEN_IDEAS_MS = 500;

// Сколько живёт состояние ожидания выбора категории
export const SELECTION_TTL_MS = 10 * 60 * 1000;

// Префикс callback_data кнопок выбора категории
export const IDEAS_SELECTION_CALLBACK_PREFIX = 'ideas_select:';

// callback_data кнопки «Запустить генерацию» (уже зарегистрирован в bot/index.ts)
export const RUN_PIPELINE_CALLBACK = 'run_pipeline';

// Кнопки выбора категории: режим + текст
export const SELECTION_BUTTONS: Array<{ mode: IdeasSelectionMode; text: string }> = [
  { mode: 'new', text: '🆕 Самые новые' },
  { mode: 'fresh', text: '🕐 Свежие' },
  { mode: 'old', text: '📜 Старые' },
];

export const SELECTION_PROMPT_TEXT =
  '🎯 Выбери, какие идеи получить:';

export const NO_IDEAS_TEXT =
  '📭 Нет новых идей для постов.\n\n' +
  'Запусти пайплайн генерации, чтобы получить свежие идеи из каналов конкурентов.';

export const RUN_PIPELINE_BUTTON_TEXT = '🚀 Запустить генерацию';

export const SEND_IN_PROGRESS_TEXT = '⏳ Предыдущая отправка ещё выполняется.';

export const SELECTION_EXPIRED_TEXT =
  '⏳ Дождись окончания предыдущего запроса или начни заново: /ideas';

export const INVALID_CALLBACK_TEXT = '❌ Неверные данные';

export const SENDING_TOAST_TEXT = '⏳ Отправляю идеи...';
