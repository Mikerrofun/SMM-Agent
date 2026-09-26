import { initializeTelegramClient, disconnectClient } from '../../shared/telegram/client';
import { parseCompetitorsChannels } from '../../parser/competitors/parser';
import { getUnprocessedCompetitorPosts, countAcceptedIdeasFromRun } from '../../repositories/ideaRepository';
import { processIdeaBatch } from '../idea/ideaProcessor';
import { deduplicateIdeas } from '../idea/deduplicationService';
import {
  createGenerationRun,
  updateGenerationRunSuccess,
  updateGenerationRunFailed,
  updateGenerationRunCancelled,
} from '../../repositories/generationRunRepository';
import { checkCancelled } from '../../shared/utils/CommandManager/CommandManager';
import { CommandCancelledError } from '../../shared/utils/CommandManager/CommandManager.errors';
import type { CompetitorParseStatistics } from '../../shared/types/competitorPost.types';
import type { IdeaProcessStats } from '../idea/ideaProcessor.types';
import type { DeduplicationStats } from '../shared/deduplication.types';
import type { PipelineResult, PipelineProgressCallback } from './pipelineService.types';

export async function runFullPipeline(
  onProgress: PipelineProgressCallback
): Promise<PipelineResult> {
  let client;
  let generationRun;

  // Частично посчитанная статистика на момент отмены — сохраняем той, что уже есть
  let parsingStats: CompetitorParseStatistics | undefined;
  let ideasStats: IdeaProcessStats | undefined;
  let deduplicationStats: DeduplicationStats | undefined;

  try {
    generationRun = await createGenerationRun();
    console.log(`📝 Created GenerationRun: ${generationRun.id}`);

    checkCancelled();

    await onProgress('parsing', '📡 *Парсинг каналов конкурентов*\n\n⏳ Инициализация...');

    checkCancelled();

    client = await initializeTelegramClient();

    await onProgress(
      'parsing',
      '📡 *Парсинг каналов конкурентов*\n\n🔄 Загрузка новых постов...'
    );

    parsingStats = await parseCompetitorsChannels(
      client,
      (channelName, current, total) => {
        // Отмена проверяется по каналу (точка невозврата — запись в БД, не здесь)
        checkCancelled();

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

    checkCancelled();

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

    checkCancelled();

    deduplicationStats = await deduplicateIdeas({
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

    checkCancelled();

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
    if (error instanceof CommandCancelledError) {
      console.log('Pipeline cancelled by user');

      if (generationRun) {
        await updateGenerationRunCancelled(generationRun.id, {
          ...(parsingStats && { processedPosts: parsingStats.savedPosts }),
          ...(ideasStats && { generatedIdeas: ideasStats.succeeded }),
          ...(deduplicationStats && { acceptedIdeas: deduplicationStats.unique }),
        });
      }

      // Прокидываем отмену как есть — execute различает её по классу ошибки
      throw error;
    }

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
