import { initializeTelegramClient, disconnectClient } from '../../shared/telegram/client';
import { parseCompetitorsChannels } from '../../parser/competitors/parser';
import { getUnprocessedCompetitorPosts, countAcceptedIdeasFromRun } from '../../repositories/ideaRepository';
import { processIdeaBatch } from '../idea/ideaProcessor';
import { deduplicateIdeas } from '../idea/deduplicationService';
import {
  createGenerationRun,
  updateGenerationRunSuccess,
  updateGenerationRunFailed,
} from '../../repositories/generationRunRepository';
import type { PipelineResult, PipelineProgressCallback } from './pipelineService.types';

export async function runFullPipeline(
  onProgress: PipelineProgressCallback
): Promise<PipelineResult> {
  let client;
  let generationRun;

  try {
    generationRun = await createGenerationRun();
    console.log(`📝 Created GenerationRun: ${generationRun.id}`);

    await onProgress('parsing', '📡 *Парсинг каналов конкурентов*\n\n⏳ Инициализация...');

    client = await initializeTelegramClient();

    await onProgress(
      'parsing',
      '📡 *Парсинг каналов конкурентов*\n\n🔄 Загрузка новых постов...'
    );

    const parsingStats = await parseCompetitorsChannels(
      client,
      (channelName, current, total) => {
        void onProgress(
          'parsing',
          `📡 *Парсинг каналов конкурентов*\n\n` +
          `📥 Обработка: ${channelName}\n` +
          `Прогресс: ${current}/${total}`
        );
      }
    );

    await onProgress(
      'parsing',
      `📡 *Парсинг каналов конкурентов*\n\n` +
      `✅ Завершено!\n` +
      `• Каналов: ${parsingStats.totalChannels}\n` +
      `• Новых постов: ${parsingStats.savedPosts}`
    );

    await onProgress(
      'ideas',
      '💡 *Генерация идей*\n\n🔄 Загрузка постов для обработки...'
    );

    const posts = await getUnprocessedCompetitorPosts();

    let ideasStats;

    if (posts.length === 0) {
      await onProgress(
        'ideas',
        '💡 *Генерация идей*\n\n✅ Все посты уже обработаны!'
      );
      
      ideasStats = {
        total: 0,
        succeeded: 0,
        failed: 0,
        failedItems: [],
      };
    } else {
      await onProgress(
        'ideas',
        `💡 *Генерация идей*\n\n🤖 Обработка ${posts.length} постов через AI...`
      );

      ideasStats = await processIdeaBatch({
        items: posts,
        onProgress: (current, total) => {
          void onProgress(
            'ideas',
            `💡 *Генерация идей*\n\n` +
            `🤖 Обработка через AI...\n` +
            `Прогресс: ${current}/${total}`
          );
        },
      });

      await onProgress(
        'ideas',
        `💡 *Генерация идей*\n\n` +
        `✅ Завершено!\n` +
        `• Обработано: ${ideasStats.total}\n` +
        `• Создано идей: ${ideasStats.succeeded}`
      );
    }

    await onProgress(
      'deduplication',
      '🔍 *Дедупликация идей*\n\n🔄 Векторный поиск дубликатов...'
    );

    const deduplicationStats = await deduplicateIdeas({
      onProgress: (current, total) => {
        void onProgress(
          'deduplication',
          `🔍 *Дедупликация идей*\n\n` +
          `🔎 Проверка через векторный поиск...\n` +
          `Прогресс: ${current}/${total}`
        );
      },
    });

    await onProgress(
      'deduplication',
      `🔍 *Дедупликация идей*\n\n` +
      `✅ Завершено!\n` +
      `• Уникальных: ${deduplicationStats.unique}\n` +
      `• Дубликатов: ${deduplicationStats.duplicates}`
    );

    // Подсчитываем только уникальные идеи из текущего прогона для записи в GenerationRun
    const acceptedIdeasCount = await countAcceptedIdeasFromRun(generationRun.startedAt);

    await updateGenerationRunSuccess(generationRun.id, {
      processedPosts: parsingStats.savedPosts,
      generatedIdeas: ideasStats.succeeded,
      acceptedIdeas: acceptedIdeasCount,
    });

    return {
      parsing: parsingStats,
      ideas: ideasStats,
      deduplication: deduplicationStats,
      acceptedIdeasFromRun: acceptedIdeasCount,
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Pipeline error:', error);
    
    if (generationRun) {
      await updateGenerationRunFailed(generationRun.id);
    }
    
    throw new Error(`Ошибка выполнения пайплайна: ${errorMessage}`);

  } finally {
    if (client) {
      await disconnectClient(client);
    }
  }
}
