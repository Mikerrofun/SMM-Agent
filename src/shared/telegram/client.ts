import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { getTelegramConfig } from '../../config/telegram.config';
import { TELEGRAM_RETRY_CONFIG } from './config';
import { authorizeClient } from './auth';

export async function initializeTelegramClient(): Promise<TelegramClient> {
  const config = getTelegramConfig();

  console.log('🔧 Initializing Telegram client...');

  const session = new StringSession(config.sessionString);
  const client = new TelegramClient(
    session,
    config.apiId,
    config.apiHash,
    {
      connectionRetries: TELEGRAM_RETRY_CONFIG.maxAttempts,
    }
  );

  // client.start() уже делает подключение и авторизацию
  const hasExistingSession = config.sessionString.length > 0;
  await authorizeClient(client, config.apiId, config.apiHash, hasExistingSession);

  return client;
}

export async function disconnectClient(client: TelegramClient): Promise<void> {
  try {
    console.log('🔌 Disconnecting from Telegram...');
    await client.disconnect();
    console.log('✅ Disconnected successfully');
  } catch (error) {
    const err = error as Error;
    console.error(`⚠️  Error during disconnect: ${err.message}`);
  }
}
