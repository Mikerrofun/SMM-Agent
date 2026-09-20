/**
 * Public API сервиса генерации постов из главных идей канала Натальи
 */

export {
  processNataliaChannelPosts,
  generateAdditionalNataliaChannelPost,
} from './nataliaChannelPostService';

export type { NataliaChannelProcessingResult } from './nataliaChannelPost.types';

export {
  POSTS_PER_RUN,
  MAX_ATTEMPTS_PER_POST,
  AI_RETRY_CONFIG,
} from './nataliaChannelPost.config';
