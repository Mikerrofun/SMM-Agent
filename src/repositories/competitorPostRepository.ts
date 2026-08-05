import { prisma } from '../db/client';
import { CreateCompetitorPostInput } from '../shared/types/competitorPost.types';

export async function createManyCompetitorPosts(
  posts: CreateCompetitorPostInput[]
): Promise<number> {
  if (posts.length === 0) {
    return 0;
  }

  try {
    const result = await prisma.competitorPost.createMany({
      data: posts,
      skipDuplicates: true,
    });

    return result.count;
  } catch (error) {
    const err = error as Error;
    throw new Error(
      `Failed to batch insert competitor posts: ${err.message}`
    );
  }
}

export async function getLatestPublishedDateForCompetitor(
  competitorId: string
): Promise<Date | null> {
  const latestPost = await prisma.competitorPost.findFirst({
    where: {
      competitorId,
    },
    orderBy: {
      publishedAt: 'desc',
    },
    select: {
      publishedAt: true,
    },
  });

  return latestPost?.publishedAt ?? null;
}
