import { prisma } from '../db/client';
import type { CreateIdeaInput, IdeaProcessItem, IdeaStatus, IdeaWithEmbedding } from '../shared/types/idea.types';
import type { IdeaModel } from '../db/generated/models/Idea';
import type { SimilarityMatch, DuplicateOfType } from '../services/idea/deduplication.types';


export async function getUnprocessedCompetitorPosts(): Promise<IdeaProcessItem[]> {
  const posts = await prisma.competitorPost.findMany({
    where: {
      isProcessed: false,
    },
    select: {
      id: true,
      text: true,
    },
    orderBy: {
      publishedAt: 'asc',
    },
  });

  return posts;
}

/**
 * Создаёт идею в БД и помечает связанный пост конкурента как обработанным.
 * Выполняется атомарно в транзакции.
 * @param data — данные для создания идеи (включая обязательный embedding)
 * @returns созданная идея
 * @throws при ошибке БД
 */
export async function createIdeaAndMarkProcessed(
  data: CreateIdeaInput
): Promise<IdeaModel> {
  return prisma.$transaction(async (tx) => {
    const vectorLiteral = `[${data.embedding.join(',')}]`;
    
    const result = await tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO "Idea" (
        id, "competitorPostId", title, "mainIdea", goal,
        embedding, status, "createdAt"
      )
      VALUES (
        gen_random_uuid(), ${data.competitorPostId},
        ${data.title}, ${data.mainIdea}, ${data.goal},
        ${vectorLiteral}::vector, 'NEW', NOW()
      )
      RETURNING id
    `;
    
    const ideaId = result[0].id;
    
    await tx.competitorPost.update({
      where: { id: data.competitorPostId },
      data: { isProcessed: true },
    });
    
    const createdIdea = await tx.idea.findUnique({
      where: { id: ideaId },
    });
    
    if (!createdIdea) {
      throw new Error('Failed to retrieve created idea');
    }
    
    return createdIdea;
  });
}


export async function countIdeas(): Promise<number> {
  return prisma.idea.count();
}

export async function countUnprocessedCompetitorPosts(): Promise<number> {
  return prisma.competitorPost.count({
    where: {
      isProcessed: false,
    },
  });
}

/**
 * Получает новые идеи для отправки в Telegram.
 * Возвращает идеи со статусом NEW, отсортированные по дате создания.
 *
 * @param limit — максимальное количество идей (по умолчанию 10)
 * @returns массив идей со статусом NEW
 */
export async function getNewIdeasForSending(limit: number = 10): Promise<IdeaModel[]> {
  return prisma.idea.findMany({
    where: {
      status: 'NEW',
    },
    orderBy: {
      createdAt: 'desc',
    },
    take: limit,
  });
}

/**
 * Получает идеи по статусу.
 *
 * @param status — статус идей (NEW, SENT, SELECTED, REJECTED, DUPLICATE)
 * @param limit — максимальное количество идей
 * @returns массив идей с указанным статусом
 */
export async function getIdeasByStatus(
  status: IdeaStatus,
  limit?: number
): Promise<IdeaModel[]> {
  return prisma.idea.findMany({
    where: {
      status,
    },
    orderBy: {
      createdAt: 'desc',
    },
    ...(limit && { take: limit }),
  });
}

/**
 * Подсчитывает количество идей по статусу.
 *
 * @param status — статус идей
 * @returns количество идей с указанным статусом
 */
export async function countIdeasByStatus(
  status: IdeaStatus
): Promise<number> {
  return prisma.idea.count({
    where: {
      status,
    },
  });
}

// ─────────────────────────────────────────────────────────────
// Методы для дедупликации через векторный поиск
// ─────────────────────────────────────────────────────────────

export async function getNewIdeasWithEmbeddings(): Promise<IdeaWithEmbedding[]> {
  const result = await prisma.$queryRaw<IdeaWithEmbedding[]>`
    SELECT id, embedding::text, "createdAt"
    FROM "Idea"
    WHERE status = 'NEW'
      AND embedding IS NOT NULL
    ORDER BY "createdAt" ASC
  `;

  return result;
}

/**
 * Находит похожие идеи через cosine similarity (pgvector).
 * @param embedding — вектор для сравнения (массив чисел)
 * @param threshold — минимальное значение similarity (от 0 до 1)
 * @param excludeId — ID идеи, которую нужно исключить (не сравнивать саму с собой)
 * @returns массив совпадений, отсортированных по createdAt ASC (самая старая первая)
 * @throws при ошибке БД
 */
export async function findSimilarIdeas(
  embedding: number[],
  threshold: number,
  excludeId: string
): Promise<SimilarityMatch[]> {
  const vectorLiteral = `[${embedding.join(',')}]`;

  const result = await prisma.$queryRaw<
    Array<{ id: string; similarity: number; createdAt: Date }>
  >`
    SELECT 
      id,
      (1 - (embedding <=> ${vectorLiteral}::vector)) AS similarity,
      "createdAt"
    FROM "Idea"
    WHERE embedding IS NOT NULL
      AND status = ANY(ARRAY['NEW', 'SENT']::"IdeaStatus"[])
      AND id != ${excludeId}
      AND (1 - (embedding <=> ${vectorLiteral}::vector)) >= ${threshold}
    ORDER BY similarity DESC, "createdAt" ASC
  `;

  return result.map((row) => ({
    id: row.id,
    similarity: Number(row.similarity),
    createdAt: row.createdAt,
  }));
}

export async function updateMaxSimilarity(
  ideaId: string,
  similarity: number
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "Idea"
    SET similarity = ${similarity}
    WHERE id = ${ideaId}
  `;
}


export async function markAsDuplicate(
  ideaId: string,
  duplicateOfType: DuplicateOfType,
  duplicateOfId: string,
  similarity: number
): Promise<void> {
  try {
    await prisma.$executeRaw`
      UPDATE "Idea"
      SET 
        status = 'DUPLICATE',
        "duplicateOfType" = ${duplicateOfType},
        "duplicateOfId" = ${duplicateOfId},
        similarity = ${similarity}
      WHERE id = ${ideaId}
    `;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to mark idea ${ideaId} as duplicate: ${message}`);
  }
}

/**
 * Обновляет статус идей с NEW на SENT атомарно.
 * Используется после отправки идей пользователю в Telegram.
 *
 * @param ideaIds — массив ID идей для обновления статуса
 * @returns количество обновленных записей
 * @throws при ошибке БД
 */
export async function markIdeasAsSent(ideaIds: string[]): Promise<number> {
  if (ideaIds.length === 0) {
    return 0;
  }

  const result = await prisma.idea.updateMany({
    where: {
      id: { in: ideaIds },
      status: 'NEW',
    },
    data: {
      status: 'SENT',
    },
  });

  return result.count;
}

/**
 * Подсчитывает количество уникальных (не DUPLICATE) идей созданных после указанной даты.
 * Используется для статистики GenerationRun.
 *
 * @param createdAfter — дата начала прогона
 * @returns количество уникальных идей из прогона
 */
export async function countAcceptedIdeasFromRun(createdAfter: Date): Promise<number> {
  return prisma.idea.count({
    where: {
      createdAt: { gte: createdAfter },
      status: { not: 'DUPLICATE' },
    },
  });
}
