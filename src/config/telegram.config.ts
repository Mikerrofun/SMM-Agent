import { z } from 'zod';

const TelegramConfigSchema = z.object({
  apiId: z
    .string()
    .min(1, 'TELEGRAM_API_ID is required')
    .transform((val) => {
      const num = parseInt(val, 10);
      if (isNaN(num)) {
        throw new Error('TELEGRAM_API_ID must be a valid number');
      }
      return num;
    }),
  apiHash: z
    .string()
    .min(1, 'TELEGRAM_API_HASH is required')
    .length(32, 'TELEGRAM_API_HASH must be exactly 32 characters'),
  sessionString: z.string().default(''),
});

export type TelegramConfig = z.infer<typeof TelegramConfigSchema>;

export function getTelegramConfig(): TelegramConfig {
  try {
    const config = TelegramConfigSchema.parse({
      apiId: process.env.TELEGRAM_API_ID,
      apiHash: process.env.TELEGRAM_API_HASH,
      sessionString: process.env.TELEGRAM_SESSION_STRING || '',
    });

    return config;
  } catch (error) {
    if (error instanceof z.ZodError) {
      const messages = error.issues.map((err) => `${err.path.join('.')}: ${err.message}`);
      throw new Error(
        `Telegram configuration validation failed:\n${messages.join('\n')}\n\n` +
          `Please check your .env file and ensure:\n` +
          `1. TELEGRAM_API_ID is set to a valid number\n` +
          `2. TELEGRAM_API_HASH is set to a 32-character hash\n` +
          `3. Get credentials from: https://my.telegram.org/auth`
      );
    }
    throw error;
  }
}
