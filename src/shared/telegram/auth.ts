import { TelegramClient } from 'telegram';
import { TelegramAuthError } from '../../parser/natalia/errors';
import { promptInput } from './utils';

export async function authorizeClient(
  client: TelegramClient,
  apiId: number,
  apiHash: string,
  hasExistingSession: boolean
): Promise<void> {
  try {
    let isNewAuthorization = false;

    await client.start({
      phoneNumber: async () => {
        isNewAuthorization = true;
        console.log('\n🔐 Authorization required');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        return await promptInput('Enter your phone number (with country code, e.g., +1234567890): ');
      },
      password: async () => {
        return await promptInput('Enter your 2FA password (if enabled): ');
      },
      phoneCode: async () => {
        console.log('📨 Verification code sent to your Telegram app');
        return await promptInput('Enter the verification code: ');
      },
      onError: (err) => {
        console.error('❌ Error during authorization:', err.message);
      },
    });

    if (isNewAuthorization) {
      console.log('✅ Authorization successful!');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      const sessionString = client.session.save() as unknown as string;

      console.log('\n📋 IMPORTANT: Save this session string to your .env file:');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`TELEGRAM_SESSION_STRING="${sessionString}"`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    } else if (hasExistingSession) {
      console.log('✅ Using existing session (already authorized)');
    }
  } catch (error) {
    const err = error as Error;
    throw new TelegramAuthError(
      `Authorization failed: ${err.message}`,
      err
    );
  }
}
