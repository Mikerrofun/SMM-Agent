/**
 * Типы для сервиса генерации постов из главных идей канала Натальи
 */

import type { NataliaChannelPostData } from '../../shared/types/nataliaChannelPost.types';
import type { PostGenerationStats } from '../shared/postGeneration/postGeneration.types';

/**
 * Результат обработки команды /natalia_channel_post
 */
export interface NataliaChannelProcessingResult {
  /** Количество запрошенных постов (целевая цель) */
  requestedPosts: number;
  /** Успешно сгенерированные посты */
  posts: NataliaChannelPostData[];
  /** Статистика генерации */
  stats: PostGenerationStats;
  /** Ошибки, возникшие в процессе */
  errors: string[];
}
