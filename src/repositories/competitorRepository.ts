import { prisma } from '../db/client';
import { Competitor } from '../db/generated/client';

export async function getActiveCompetitors(): Promise<Competitor[]> {
  return prisma.competitor.findMany({
    where: {
      isActive: true,
    },
    orderBy: {
      name: 'asc',
    },
  });
}

export async function deactivateCompetitor(id: string): Promise<void> {
  await prisma.competitor.update({
    where: { id },
    data: { isActive: false },
  });
}
