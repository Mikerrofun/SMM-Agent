import { prisma } from '../db/client';
import { GenerationRun, RunStatus } from '../db/generated/client';

/**
 * Получить последний успешный прогон генерации
 */
export async function getLastSuccessfulRun(): Promise<GenerationRun | null> {
  return prisma.generationRun.findFirst({
    where: {
      status: RunStatus.SUCCESS,
    },
    orderBy: {
      finishedAt: 'desc',
    },
  });
}

/**
 * Определить cutoff date для парсинга
 * - Если есть последний успешный прогон → его finishedAt
 * - Если нет → текущая дата минус lookbackDays
 * 
 * @param lookbackDays - Кол-во дней назад для первого запуска
 * @returns Date для фильтрации постов
 */
export async function determineCutoffDate(lookbackDays: number): Promise<Date> {
  const lastRun = await getLastSuccessfulRun();
  
  if (lastRun?.finishedAt) {
    console.log(
      `🔄 Incremental mode: fetching posts newer than last successful run (${lastRun.finishedAt.toISOString()})`
    );
    return lastRun.finishedAt;
  }
  
  const cutoffDate = new Date(
    Date.now() - lookbackDays * 24 * 60 * 60 * 1000
  );
  
  console.log(
    `🆕 First run: fetching posts from the last ${lookbackDays} day(s)`
  );
  
  return cutoffDate;
}
