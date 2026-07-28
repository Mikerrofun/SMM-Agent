import { TelegramClient } from 'telegram';
import { NetworkError, isNetworkError } from '../../parser/natalia/errors';
import { TELEGRAM_RETRY_CONFIG } from './config';
import { sleep } from './utils';

export async function connectWithRetry(
  client: TelegramClient,
  config: typeof TELEGRAM_RETRY_CONFIG = TELEGRAM_RETRY_CONFIG
): Promise<void> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      console.log(`📡 Connecting to Telegram... (attempt ${attempt}/${config.maxAttempts})`);
      await client.connect();
      console.log('✅ Connected to Telegram successfully');
      return;
    } catch (error) {
      lastError = error as Error;

      if (isNetworkError(error)) {
        console.log(`⚠️  Network error: ${lastError.message}`);

        if (attempt < config.maxAttempts) {
          console.log(`⏳ Retrying in ${config.delayMs / 1000} seconds...`);
          await sleep(config.delayMs);
          continue;
        }
      }

      throw new NetworkError(
        `Failed to connect after ${attempt} attempts: ${lastError.message}`,
        lastError
      );
    }
  }
}
