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
