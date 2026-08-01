import { TelegramClient } from 'telegram';
import { Api } from 'telegram';
import { getLatestPublishedDate } from '../../repositories/nataliaPostRepository';
import { ParseStatistics, ProgressCallback, CreateNataliaPostInput } from '../../types/nataliaPost.types';
import { ParserError } from './errors';
import { PARSER_CONFIG } from './config';
import { getChannel } from '../../shared/telegram';
import { processMessageBatch, saveFinalBatch } from './batchProcessor';

export async function parseNataliaChannel(
  client: TelegramClient,
  onProgress?: ProgressCallback
): Promise<ParseStatistics> {
  console.log(`\n📡 Starting to parse channel @${PARSER_CONFIG.CHANNEL_USERNAME}`);
  console.log(`📅 Cutoff date: ${PARSER_CONFIG.CUTOFF_DATE.toISOString()}`);

  // Получаем последнюю дату для инкрементальной загрузки
  const latestPublishedAt = await getLatestPublishedDate();
  const incrementalCutoff = latestPublishedAt || PARSER_CONFIG.CUTOFF_DATE;

  if (latestPublishedAt) {
    console.log(
      `🔄 Incremental mode: fetching posts newer than ${latestPublishedAt.toISOString()}`
    );
  } else {
    console.log(
      `🆕 First run: fetching all posts since ${PARSER_CONFIG.CUTOFF_DATE.toISOString()}`
    );
  }

  // Проверяем канал
  const channel = await getChannel(client, PARSER_CONFIG.CHANNEL_USERNAME);

  const stats: ParseStatistics = {
    total: 0,
    saved: 0,
    skipped: 0,
    errors: 0,
  };

  let batch: CreateNataliaPostInput[] = [];
  let offsetId = 0;
  let shouldContinue = true;
  const processedCount = { value: 0 };

  // Получаем сообщения пакетами
  while (shouldContinue) {
    const messages = await fetchMessages(client, channel, offsetId, stats);
    
    if (!messages || messages.length === 0) {
      console.log('\n✅ Reached end of channel history');
      break;
    }

    // Обновляем offsetId для следующей итерации
    offsetId = messages[messages.length - 1]?.id || offsetId;

    // Обрабатываем батч сообщений
    const result = await processMessageBatch(
      messages,
      incrementalCutoff,
      batch,
      stats,
      processedCount,
      onProgress
    );

    batch = result.batch;
    
    if (result.shouldStop) {
      shouldContinue = false;
      break;
    }

    // Если получили меньше сообщений, чем запрашивали — достигли конца
    if (messages.length < PARSER_CONFIG.MESSAGES_PER_REQUEST) {
      shouldContinue = false;
    }
  }

  // Сохраняем оставшиеся посты
  await saveFinalBatch(batch, stats, processedCount, onProgress);

  return stats;
}

async function fetchMessages(
  client: TelegramClient,
  channel: Api.Channel,
  offsetId: number,
  stats: ParseStatistics
): Promise<Api.Message[] | null> {
  try {
    const result = await client.getMessages(channel, {
      limit: PARSER_CONFIG.MESSAGES_PER_REQUEST,
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

