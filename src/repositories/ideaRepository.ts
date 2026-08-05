import { prisma } from '../db/client';
import type { CreateIdeaInput, IdeaProcessItem, IdeaStatus } from '../shared/types/idea.types';
import type { IdeaModel } from '../db/generated/models/Idea';


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
 *
 * Embedding обязателен. Используется raw SQL для INSERT с pgvector типом.
 * Prisma не поддерживает vector тип нативно, поэтому используем $queryRaw.
 *
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
