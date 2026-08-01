import { TelegramClient } from 'telegram';
import { Api } from 'telegram';
import { Competitor } from '../../db/generated/client';
import { 
  ChannelParseStatistics, 
  CreateCompetitorPostInput,
  CompetitorProgressCallback 
} from '../../types/competitorPost.types';
import { 
  validateMessageData,
  extractMessageText,
  extractMessageDate,
  getChannel
} from '../../shared/telegram';
import { createManyCompetitorPosts } from '../../repositories/competitorPostRepository';
import { deactivateCompetitor } from '../../repositories/competitorRepository';
import { ChannelNotFoundError, isNetworkError } from './errors';
import { COMPETITORS_PARSER_CONFIG } from './config';

/**
 * Парсит один канал конкурента
 */
export async function parseCompetitorChannel(
  client: TelegramClient,
  competitor: Competitor,
  cutoffDate: Date,
  onProgress?: CompetitorProgressCallback
): Promise<ChannelParseStatistics> {
  const stats: ChannelParseStatistics = {
    channelName: competitor.name,
    channelUsername: extractUsername(competitor.url),
    total: 0,
    saved: 0,
    skipped: 0,
    errors: 0,
    isAccessible: true,
  };

  try {
    const channel = await getChannel(client, stats.channelUsername);
    
    console.log(`\n📡 Parsing ${stats.channelName} (@${stats.channelUsername})`);
    
    await parseMessages(
      client, 
      channel, 
      competitor.id, 
      cutoffDate, 
      stats, 
      onProgress
    );
    
    return stats;
    
  } catch (error) {
    // Если канал недоступен (не сетевая ошибка) - деактивируем
    if (error instanceof ChannelNotFoundError && !isNetworkError(error)) {
      console.log(
        `\n⚠️  Channel @${stats.channelUsername} is not accessible. Deactivating...`
      );
      
      try {
        await deactivateCompetitor(competitor.id);
        stats.isAccessible = false;
        console.log(`✅ Channel @${stats.channelUsername} deactivated`);
      } catch (deactivateError) {
        const err = deactivateError as Error;
        console.error(
          `❌ Failed to deactivate channel @${stats.channelUsername}: ${err.message}`
        );
      }
      
      return stats;
    }
    
    // Сетевые и другие ошибки пробрасываем выше
    throw error;
  }
}

async function parseMessages(
  client: TelegramClient,
  channel: Api.Channel,
  competitorId: string,
  cutoffDate: Date,
  stats: ChannelParseStatistics,
  onProgress?: CompetitorProgressCallback
): Promise<void> {
  let batch: CreateCompetitorPostInput[] = [];
  let offsetId = 0;
  let shouldContinue = true;
  let processedCount = 0;

  while (shouldContinue) {
    const messages = await fetchMessages(client, channel, offsetId, stats);
    
    if (!messages || messages.length === 0) {
      break;
    }

    // offsetId для пагинации - ID последнего сообщения
    offsetId = messages[messages.length - 1]?.id || offsetId;

    for (const message of messages) {
      if (!validateMessageData(message, cutoffDate)) {
        stats.skipped++;
        continue;
      }

      const messageDate = extractMessageDate(message);
      
      // Инкрементальная загрузка: если дошли до старых - останавливаемся
      if (messageDate && messageDate < cutoffDate) {
        console.log(
          `  ⏹️  Reached cutoff date (${messageDate.toISOString()})`
        );
        shouldContinue = false;
        break;
      }

      const text = extractMessageText(message);
      const telegramPostUrl = `https://t.me/${stats.channelUsername}/${message.id}`;
      const publishedAt = messageDate || new Date();

      batch.push({
        competitorId,
        text,
        telegramPostUrl,
        publishedAt,
      });

      // Батчинг: сохраняем по 20 постов
      if (batch.length >= COMPETITORS_PARSER_CONFIG.BATCH_SIZE) {
        await saveBatch(batch, stats, processedCount, onProgress);
        processedCount += batch.length;
        batch = [];
      }
    }

    if (!shouldContinue) {
      break;
    }

    if (messages.length < COMPETITORS_PARSER_CONFIG.MESSAGES_PER_REQUEST) {
      shouldContinue = false;
    }
  }

  if (batch.length > 0) {
    await saveBatch(batch, stats, processedCount, onProgress);
  }
}

async function fetchMessages(
  client: TelegramClient,
  channel: Api.Channel,
  offsetId: number,
  stats: ChannelParseStatistics
): Promise<Api.Message[] | null> {
  try {
    const result = await client.getMessages(channel, {
      limit: COMPETITORS_PARSER_CONFIG.MESSAGES_PER_REQUEST,
      offsetId: offsetId,
    });

    const messages = result as Api.Message[];
    stats.total += messages.length;
    
    return messages;
  } catch (error) {
    const err = error as Error;
    console.error(`\n❌ Error fetching messages: ${err.message}`);
    stats.errors++;
    return null;
  }
}

async function saveBatch(
  batch: CreateCompetitorPostInput[],
  stats: ChannelParseStatistics,
  processedCount: number,
  onProgress?: CompetitorProgressCallback
): Promise<void> {
  try {
    // createMany с skipDuplicates: true
    // Вернет кол-во реально созданных записей (дубли пропускаются)
    const savedCount = await createManyCompetitorPosts(batch);
    stats.saved += savedCount;
    stats.skipped += batch.length - savedCount; // Дубли
    
    if (onProgress) {
      onProgress(stats.channelName, processedCount + batch.length, stats.total);
    }
  } catch (error) {
    const err = error as Error;
    console.error(`\n⚠️  Error saving batch: ${err.message}`);
    stats.errors += batch.length;
  }
}

function extractUsername(url: string): string {
  // Извлекаем username из URL вида https://t.me/username или @username
  const match = url.match(/(?:https?:\/\/t\.me\/|@)([a-zA-Z0-9_]+)/);
  return match ? match[1] : url;
}
