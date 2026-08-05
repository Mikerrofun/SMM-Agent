import { TelegramClient } from 'telegram';
import { 
  CompetitorParseStatistics, 
  ChannelParseStatistics,
  CompetitorProgressCallback 
} from '../../shared/types/competitorPost.types';
import { getActiveCompetitors } from '../../repositories/competitorRepository';
import { determineCutoffDate } from '../../repositories/generationRunRepository';
import { parseCompetitorChannel } from './channelProcessor';
import { COMPETITORS_PARSER_CONFIG } from './config';
import { isNetworkError } from './errors';

export async function parseCompetitorsChannels(
  client: TelegramClient,
  onProgress?: CompetitorProgressCallback
): Promise<CompetitorParseStatistics> {
  console.log('\n🚀 Starting competitor channels parsing');
  
  const competitors = await getActiveCompetitors();
  
  if (competitors.length === 0) {
    console.log('\n⚠️  No active competitors found');
    return createEmptyStatistics();
  }
  
  console.log(`📋 Found ${competitors.length} active competitor(s)`);
  
  // Определить cutoff date (из repository)
  const cutoffDate = await determineCutoffDate(
    COMPETITORS_PARSER_CONFIG.DEFAULT_LOOKBACK_DAYS
  );
  
  console.log(`📅 Cutoff date: ${cutoffDate.toISOString()}`);
  
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
  
  for (const competitor of competitors) {
    try {
      const channelStats = await parseCompetitorChannel(
        client,
        competitor,
        cutoffDate,
        onProgress
      );
      

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
      
    } catch (error) {
      const err = error as Error;
      
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
    }
  }
  
  console.log('\n✅ Parsing completed');
  
  return stats;
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
