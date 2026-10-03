import type { IdeaModel } from '../../../db/generated/models/Idea';

/**
 * Режим выборки категории идей.
 */
export type IdeasSelectionMode = 'new' | 'fresh' | 'old';

/**
 * Состояние ожидания выбора категории (по chat-идентификатору пользователя).
 */
export type IdeasSelectionState = {
  createdAt: Date;
};

/**
 * Результат рассылки порции идей.
 */
export type IdeasBatchResult = {
  /** Сколько идей реально ушло хотя бы одному получателю */
  sentIdeas: number;
  /** Сколько карточек идей не удалось отправить */
  failedIdeas: number;
  /** Сколько чатов-получателей было */
  recipients: number;
  /** Сколько чатов получили итоговую строку */
  summarySent: number;
};

/**
 * Функция получения порции идей для режима — маппится в боевом слое,
 * репозиторий остаётся не знающим про UI.
 */
export type IdeasFetcher = (limit: number) => Promise<IdeaModel[]>;
