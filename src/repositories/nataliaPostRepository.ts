import { prisma } from '../db/client';
import { CreateNataliaPostInput } from '../types/nataliaPost.types';

export async function getLatestPublishedDate(): Promise<Date | null> {
  const latestPost = await prisma.nataliaPost.findFirst({
    orderBy: {
      publishedAt: 'desc',
    },
    select: {
      publishedAt: true,
    },
  });

  return latestPost?.publishedAt ?? null;
}

export async function createManyNataliaPosts(
  posts: CreateNataliaPostInput[]
): Promise<number> {
  if (posts.length === 0) {
    return 0;
  }

  try {
    const result = await prisma.nataliaPost.createMany({
      data: posts,
      skipDuplicates: true,
    });

    return result.count;
  } catch (error) {
    const err = error as Error;
    throw new Error(
      `Failed to batch insert posts: ${err.message}`
    );
  }
}

export async function countPosts(): Promise<number> {
  return prisma.nataliaPost.count();
}

