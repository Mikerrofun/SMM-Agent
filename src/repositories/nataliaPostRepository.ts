import { prisma } from '../db/client';
import { CreateNataliaPostInput } from '../shared/types/nataliaPost.types';

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


export async function getPostsWithoutMainIdea(): Promise<
  Array<{ id: string; text: string }>
> {
  return prisma.nataliaPost.findMany({
    where: {
      mainIdea: "",

    },
    select: {
      id: true,
      text: true,
    },
    orderBy: {
      publishedAt: "desc",
    },
  });
}


export async function updateMainIdea(
  id: string,
  mainIdea: string
): Promise<void> {
  await prisma.nataliaPost.update({
    where: { id },
    data: { mainIdea },
  });
}


export async function updateMainIdeaAndEmbedding(
  id: string,
  mainIdea: string,
  embedding: number[]
): Promise<void> {
  const vectorLiteral = `[${embedding.join(",")}]`;

  await prisma.$executeRaw`
    UPDATE "NataliaPost"
    SET "mainIdea" = ${mainIdea},
        embedding = ${vectorLiteral}::vector
    WHERE id = ${id}
  `;
}


export async function getPostsWithoutEmbedding(): Promise<
  Array<{ id: string; mainIdea: string }>
> {
  const result = await prisma.$queryRaw<Array<{ id: string; mainIdea: string }>>`
    SELECT id, "mainIdea"
    FROM "NataliaPost"
    WHERE "mainIdea" != '' AND "mainIdea" IS NOT NULL
      AND embedding IS NULL
    ORDER BY "publishedAt" DESC
  `;

  return result;
}

export async function updateEmbedding(
  id: string,
  embedding: number[]
): Promise<void> {
  const vectorLiteral = `[${embedding.join(",")}]`;

  await prisma.$executeRaw`
    UPDATE "NataliaPost"
    SET embedding = ${vectorLiteral}::vector
    WHERE id = ${id}
  `;
}


