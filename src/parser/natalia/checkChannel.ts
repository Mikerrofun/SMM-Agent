import { TelegramClient } from 'telegram';
import { Api } from 'telegram';
import { ChannelNotFoundError, ParserError } from './errors';

export async function getChannel(
  client: TelegramClient,
  username: string
): Promise<Api.Channel> {
  try {
    const entity = await client.getEntity(username);
    
    if (!(entity instanceof Api.Channel)) {
      throw new ChannelNotFoundError(
        username,
        `Entity @${username} is not a channel`
      );
    }
    
    console.log(`✅ Channel found: ${entity.title}`);
    return entity;
    
  } catch (error) {
    const err = error as Error;
    
    if (err.message.includes('No user has') || err.message.includes('not found')) {
      throw new ChannelNotFoundError(username, undefined, err);
    }
    
    throw new ParserError(
      `Failed to access channel @${username}: ${err.message}`,
      err
    );
  }
}
