import { TelegramClient } from 'telegram';
import { TelegramAuthError } from '../../parser/natalia/errors';
import { promptInput } from './utils';

export async function authorizeClient(
  client: TelegramClient,
  apiId: number,
  apiHash: string
): Promise<void> {
  try {
    const isAuthorized = await client.checkAuthorization();

    if (!isAuthorized) {
      console.log('\n🔐 Authorization required');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      const phoneNumber = await promptInput('Enter your phone number (with country code, e.g., +1234567890): ');

      await client.sendCode(
        {
          apiId,
          apiHash,
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
}
