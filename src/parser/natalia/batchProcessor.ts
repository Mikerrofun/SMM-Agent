import { Api } from 'telegram';
import { createManyNataliaPosts } from '../../repositories/nataliaPostRepository';
import { CreateNataliaPostInput, ParseStatistics, ProgressCallback } from '../../types/nataliaPost.types';
import { validateMessageData, extractMessageText, extractMessageDate } from './validator';
import { PARSER_CONFIG } from './config';

export async function processMessageBatch(
  messages: Api.Message[],
  incrementalCutoff: Date,
  batch: CreateNataliaPostInput[],
  stats: ParseStatistics,
  processedCount: { value: number },
  onProgress?: ProgressCallback
): Promise<{ batch: CreateNataliaPostInput[]; shouldStop: boolean }> {
  let shouldStop = false;

  for (const message of messages) {
    // Валидация
    if (!validateMessageData(message, PARSER_CONFIG.CUTOFF_DATE)) {
      stats.skipped++;
      continue;
    }

    const messageDate = extractMessageDate(message);
    
    // Проверка на инкрементальную загрузку
    if (messageDate && messageDate < incrementalCutoff) {
      console.log(
        `\n⏹️  Reached previously parsed messages (${messageDate.toISOString()})`
      );
      shouldStop = true;
      break;
    }

    // Сбор данных
    const text = extractMessageText(message);
    const telegramPostUrl = `https://t.me/${PARSER_CONFIG.CHANNEL_USERNAME}/${message.id}`;
    const publishedAt = messageDate || new Date();

    batch.push({
      text,
      telegramPostUrl,
      publishedAt,
      mainIdea: '',
    });

    // Сохранение батча при достижении лимита
    if (batch.length >= PARSER_CONFIG.BATCH_SIZE) {
      const savedBatch = await saveBatch(batch, stats, processedCount, onProgress);
      batch = savedBatch;
    }
  }

  return { batch, shouldStop };
}

async function saveBatch(
  batch: CreateNataliaPostInput[],
  stats: ParseStatistics,
  processedCount: { value: number },
  onProgress?: ProgressCallback
): Promise<CreateNataliaPostInput[]> {
  try {
    const savedCount = await createManyNataliaPosts(batch);
    stats.saved += savedCount;
    stats.skipped += batch.length - savedCount;
    processedCount.value += batch.length;
    
    if (onProgress) {
      onProgress(processedCount.value, stats.total);
    }
    
    return [];
  } catch (error) {
    const err = error as Error;
    console.error(`\n⚠️  Error saving batch: ${err.message}`);
    stats.errors += batch.length;
    return [];
  }
}

export async function saveFinalBatch(
  batch: CreateNataliaPostInput[],
  stats: ParseStatistics,
  processedCount: { value: number },
  onProgress?: ProgressCallback
): Promise<void> {
  if (batch.length > 0) {
    await saveBatch(batch, stats, processedCount, onProgress);
  }
}
