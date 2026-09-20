import type { DuplicateSource } from './deduplication.types';

/** Источники, схожесть с которыми трактуются как «похожесть на канал Натальи». */
export const NATALIA_SOURCES: ReadonlySet<DuplicateSource> = new Set([
  'nataliaPost',
  'nataliaChannelPost',
]);
