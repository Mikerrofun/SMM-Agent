import { prisma } from '../db/client';
import type { CreateIdeaInput, IdeaProcessItem } from '../types/idea.types';
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
 * Создаёт идею в БД и помечает связанный пост конкурента как обработанный.
 * Выполняется атомарно в транзакции.
 *
 * @param data — данные для создания идеи
 * @returns созданная идея
 * @throws при ошибке БД
 */

export async function createIdeaAndMarkProcessed(
  data: CreateIdeaInput
): Promise<IdeaModel> {
  return prisma.$transaction(async (tx) => {
    const idea = await tx.idea.create({
      data: {
        competitorPostId: data.competitorPostId,
        title: data.title,
        mainIdea: data.mainIdea,
        goal: data.goal,
        status: 'NEW',
      },
    });
    
    await tx.competitorPost.update({
      where: { id: data.competitorPostId },
      data: { isProcessed: true },
    });
    
    return idea;
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
  status: 'NEW' | 'SENT' | 'SELECTED' | 'REJECTED' | 'DUPLICATE',
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
  status: 'NEW' | 'SENT' | 'SELECTED' | 'REJECTED' | 'DUPLICATE'
): Promise<number> {
  return prisma.idea.count({
    where: {
      status,
    },
  });
}
