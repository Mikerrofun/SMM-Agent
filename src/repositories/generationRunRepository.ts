import { prisma } from '../db/client';
import { GenerationRun, RunStatus } from '../db/generated/client';

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

export async function createGenerationRun(): Promise<GenerationRun> {
  return prisma.generationRun.create({
    data: {
      status: RunStatus.RUNNING,
    },
  });
}

export async function updateGenerationRunSuccess(
  runId: string,
  stats: {
    processedPosts: number;
    generatedIdeas: number;
    acceptedIdeas: number;
  }
): Promise<void> {
  await prisma.generationRun.update({
    where: { id: runId },
    data: {
      finishedAt: new Date(),
      status: RunStatus.SUCCESS,
      processedPosts: stats.processedPosts,
      generatedIdeas: stats.generatedIdeas,
      acceptedIdeas: stats.acceptedIdeas,
    },
  });
}

export async function updateGenerationRunFailed(
  runId: string,
  partialStats?: {
    processedPosts?: number;
    generatedIdeas?: number;
    acceptedIdeas?: number;
  }
): Promise<void> {
  await prisma.generationRun.update({
    where: { id: runId },
    data: {
      finishedAt: new Date(),
      status: RunStatus.FAILED,
      ...(partialStats && {
        processedPosts: partialStats.processedPosts ?? 0,
        generatedIdeas: partialStats.generatedIdeas ?? 0,
        acceptedIdeas: partialStats.acceptedIdeas ?? 0,
      }),
    },
  });
}
