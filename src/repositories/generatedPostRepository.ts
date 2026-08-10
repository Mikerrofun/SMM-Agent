import { prisma } from '../db/client';
import type { GeneratedPostModel } from '../db/generated/models/GeneratedPost';
import type { IdeaWithCompetitorPost } from '../shared/types/post.types';


export async function getIdeaWithCompetitorPost(
  ideaId: string
): Promise<IdeaWithCompetitorPost | null> {
  const idea = await prisma.idea.findUnique({
    where: { id: ideaId },
    include: {
      competitorPost: {
        select: {
          id: true,
          text: true,
          telegramPostUrl: true,
          publishedAt: true,
        },
      },
    },
  });

  if (!idea) {
    return null;
  }

  return {
    id: idea.id,
    competitorPostId: idea.competitorPostId,
    title: idea.title,
    mainIdea: idea.mainIdea,
    goal: idea.goal,
    status: idea.status,
    createdAt: idea.createdAt,
    competitorPost: idea.competitorPost,
  };
}

/**
 * Создаёт сгенерированный пост и обновляет статус идеи на SELECTED.
 * Выполняется атомарно в транзакции.
 *
 * @param data — объект с ideaId и text поста
 * @returns созданный GeneratedPost
 * @throws при ошибке БД или если идея не найдена
 */

export async function createGeneratedPost(data: {
  ideaId: string;
  text: string;
}): Promise<GeneratedPostModel> {
  return prisma.$transaction(async (tx) => {
    const generatedPost = await tx.generatedPost.create({
      data: {
        ideaId: data.ideaId,
        text: data.text,
      },
    });

    await tx.idea.update({
      where: { id: data.ideaId },
      data: { status: 'SELECTED' },
    });

    return generatedPost;
  });
}


export async function getGeneratedPostByIdeaId(
  ideaId: string
): Promise<GeneratedPostModel | null> {
  return prisma.generatedPost.findUnique({
    where: { ideaId },
  });
}


export async function deleteGeneratedPostAndResetIdea(
  ideaId: string
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const existingPost = await tx.generatedPost.findUnique({
      where: { ideaId },
    });

    if (!existingPost) {
      return false;
    }

    await tx.generatedPost.delete({
      where: { ideaId },
    });

    await tx.idea.update({
      where: { id: ideaId },
      data: { status: 'SENT' },
    });

    return true;
  });
}
