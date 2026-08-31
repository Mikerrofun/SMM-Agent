import { prisma } from '../db/client';
import { CreateNataliaPostInput } from '../shared/types/nataliaPost.types';
import type { SimilarityMatch } from '../services/shared/deduplication.types';

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

// ─────────────────────────────────────────────────────────────
// Методы для дедупликации через векторный поиск
// ─────────────────────────────────────────────────────────────


/**
 * Находит похожие посты Натальи через cosine similarity (pgvector).
 * @param embedding — вектор для сравнения (массив чисел)
 * @param threshold — минимальное значение similarity (от 0 до 1)
 * @returns массив совпадений, отсортированных по similarity DESC (лучшее первое)
 * @throws при ошибке БД
 */
export async function findSimilarNataliaPosts(
  embedding: number[],
  threshold: number
): Promise<SimilarityMatch[]> {
  const vectorLiteral = `[${embedding.join(',')}]`;

  const result = await prisma.$queryRaw<
    Array<{ id: string; similarity: number; mainIdea: string }>
  >`
    SELECT 
      id,
      (1 - (embedding <=> ${vectorLiteral}::vector)) AS similarity,
      "mainIdea"
    FROM "NataliaPost"
    WHERE embedding IS NOT NULL
      AND (1 - (embedding <=> ${vectorLiteral}::vector)) >= ${threshold}
    ORDER BY similarity DESC
  `;

  return result.map((row) => ({
    id: row.id,
    similarity: Number(row.similarity),
  }));
}


