import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import * as readline from 'readline';
import { getTelegramConfig } from '../../config/telegram.config';
import { TelegramAuthError, NetworkError, isNetworkError } from '../../parser/natalia/errors';
import { RETRY_CONFIG } from '../../parser/natalia/config';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function promptInput(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

export async function initializeTelegramClient(): Promise<TelegramClient> {
  const config = getTelegramConfig();
  
  console.log('🔧 Initializing Telegram client...');
  
  const session = new StringSession(config.sessionString);
  const client = new TelegramClient(
    session,
    config.apiId,
    config.apiHash,
    {
      connectionRetries: RETRY_CONFIG.maxAttempts,
    }
  );

  // Подключение с retry
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= RETRY_CONFIG.maxAttempts; attempt++) {
    try {
      console.log(`📡 Connecting to Telegram... (attempt ${attempt}/${RETRY_CONFIG.maxAttempts})`);
      await client.connect();
      console.log('✅ Connected to Telegram successfully');
      break;
    } catch (error) {
      lastError = error as Error;
      
      if (isNetworkError(error)) {
        console.log(`⚠️  Network error: ${lastError.message}`);
        
        if (attempt < RETRY_CONFIG.maxAttempts) {
          console.log(`⏳ Retrying in ${RETRY_CONFIG.delayMs / 1000} seconds...`);
          await sleep(RETRY_CONFIG.delayMs);
          continue;
        }
      }
      
      throw new NetworkError(
        `Failed to connect after ${attempt} attempts: ${lastError.message}`,
        lastError
      );
    }
  }

  // Авторизация
  try {
    const isAuthorized = await client.checkAuthorization();
    
    if (!isAuthorized) {
      console.log('\n🔐 Authorization required');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      
      const phoneNumber = await promptInput('Enter your phone number (with country code, e.g., +1234567890): ');
      
      await client.sendCode(
        {
          apiId: config.apiId,
          apiHash: config.apiHash,
        },
        phoneNumber
      );
      
      console.log('📨 Verification code sent to your Telegram app');
      const code = await promptInput('Enter the verification code: ');
      
      await client.invoke(
        new (await import('telegram/tl')).Api.auth.SignIn({
          phoneNumber,
          phoneCodeHash: (client as any).phoneCodeHash,
          phoneCode: code,
        })
      );
      
      console.log('✅ Authorization successful!');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      
      const sessionString = client.session.save() as unknown as string;
      
      console.log('\n📋 IMPORTANT: Save this session string to your .env file:');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`TELEGRAM_SESSION_STRING="${sessionString}"`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    } else {
      console.log('✅ Using existing session (already authorized)');
    }
    
  } catch (error) {
    const err = error as Error;
    throw new TelegramAuthError(
      `Authorization failed: ${err.message}`,
      err
    );
  }

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
