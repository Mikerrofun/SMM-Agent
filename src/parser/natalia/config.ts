export const PARSER_CONFIG = {
  CHANNEL_USERNAME: 'talant_director',
  CUTOFF_DATE: new Date('2024-12-24T00:00:00.000Z'),
  BATCH_SIZE: 20,
  MESSAGES_PER_REQUEST: 100,
} as const;

export const RETRY_CONFIG = {
  maxAttempts: 3,
  delayMs: 2000,
} as const;
