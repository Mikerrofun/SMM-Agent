import { TelegramClient } from 'telegram';
import { Api } from 'telegram';
import { ChannelNotFoundError, ParserError } from './errors';

/**
 * Получает канал по username и проверяет его доступность
 * @param client - Telegram клиент
 * @param username - Username канала (без @)
 * @returns Api.Channel объект
 * @throws ChannelNotFoundError - если канал не найден или недоступен
 * @throws ParserError - если произошла другая ошибка
 */
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

