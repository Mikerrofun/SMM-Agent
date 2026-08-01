import { TelegramClient } from 'telegram';
import { 
  CompetitorParseStatistics, 
  ChannelParseStatistics,
  CompetitorProgressCallback 
} from '../../types/competitorPost.types';
import { getActiveCompetitors } from '../../repositories/competitorRepository';
import { getLastSuccessfulRun } from '../../repositories/generationRunRepository';
import { parseCompetitorChannel } from './channelProcessor';
import { COMPETITORS_PARSER_CONFIG } from './config';
import { isNetworkError } from './errors';

export async function parseCompetitorsChannels(
  client: TelegramClient,
  onProgress?: CompetitorProgressCallback
): Promise<CompetitorParseStatistics> {
  console.log('\n🚀 Starting competitor channels parsing');
  
  // Получить список активных конкурентов
  const competitors = await getActiveCompetitors();
  
  if (competitors.length === 0) {
    console.log('\n⚠️  No active competitors found');
    return createEmptyStatistics();
  }
  
  console.log(`📋 Found ${competitors.length} active competitor(s)`);
  
  // Определить cutoff date
  const cutoffDate = await determineCutoffDate();
  
  console.log(`📅 Cutoff date: ${cutoffDate.toISOString()}`);
  
  // Инициализация статистики
  const stats: CompetitorParseStatistics = {
    totalChannels: competitors.length,
    successfulChannels: 0,
    failedChannels: 0,
    deactivatedChannels: 0,
    totalPosts: 0,
    savedPosts: 0,
    skippedPosts: 0,
    channels: [],
  };
  
  // Итерация по каждому конкуренту
  for (const competitor of competitors) {
    try {
      const channelStats = await parseCompetitorChannel(
        client,
        competitor,
        cutoffDate,
        onProgress
      );
      
      // Обновление общей статистики
      stats.channels.push(channelStats);
      stats.totalPosts += channelStats.total;
      stats.savedPosts += channelStats.saved;
      stats.skippedPosts += channelStats.skipped;
      
      if (!channelStats.isAccessible) {
        stats.deactivatedChannels++;
        stats.failedChannels++;
      } else if (channelStats.errors > 0) {
        stats.failedChannels++;
      } else {
        stats.successfulChannels++;
      }
      
      // Логирование результата по каналу
      if (channelStats.isAccessible) {
        console.log(
          `  ✅ ${channelStats.channelName}: ${channelStats.saved} saved, ${channelStats.skipped} skipped`
        );
      } else {
        console.log(
          `  ⚠️  ${channelStats.channelName}: not accessible (deactivated)`
        );
      }
      
    } catch (error) {
      const err = error as Error;
      
      // Логирование ошибки
      console.error(
        `\n❌ Error parsing ${competitor.name} (@${extractUsername(competitor.url)}): ${err.message}`
      );
      
      // Добавляем канал в статистику с ошибкой
      stats.channels.push({
        channelName: competitor.name,
        channelUsername: extractUsername(competitor.url),
        total: 0,
        saved: 0,
        skipped: 0,
        errors: 1,
        isAccessible: false,
      });
      
      stats.failedChannels++;
      
      // Если это сетевая ошибка, можно продолжить
      if (isNetworkError(error)) {
        console.log('  ⚠️  Network error, continuing with next channel...');
        continue;
      }
      
      // Для других ошибок продолжаем
      console.log('  ⚠️  Error occurred, continuing with next channel...');
    }
  }
  
  console.log('\n✅ Parsing completed');
  
  return stats;
}

async function determineCutoffDate(): Promise<Date> {
  const lastRun = await getLastSuccessfulRun();
  
  if (lastRun?.finishedAt) {
    console.log(
      `🔄 Incremental mode: fetching posts newer than last successful run (${lastRun.finishedAt.toISOString()})`
    );
    return lastRun.finishedAt;
  }
  
  const lookbackDays = COMPETITORS_PARSER_CONFIG.DEFAULT_LOOKBACK_DAYS;
  const cutoffDate = new Date(
    Date.now() - lookbackDays * 24 * 60 * 60 * 1000
  );
  
  console.log(
    `🆕 First run: fetching posts from the last ${lookbackDays} day(s)`
  );
  
  return cutoffDate;
}

function extractUsername(url: string): string {
  // Извлекаем username из URL вида https://t.me/username или @username
  const match = url.match(/(?:https?:\/\/t\.me\/|@)([a-zA-Z0-9_]+)/);
  return match ? match[1] : url;
}

function createEmptyStatistics(): CompetitorParseStatistics {
  return {
    totalChannels: 0,
    successfulChannels: 0,
    failedChannels: 0,
    deactivatedChannels: 0,
    totalPosts: 0,
    savedPosts: 0,
    skippedPosts: 0,
    channels: [],
  };
}
