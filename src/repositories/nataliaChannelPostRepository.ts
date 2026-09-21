/**
 * Repository для NataliaChannelPost — постов, сгенерированных из главных идей
 * канала Натальи (команда /natalia_channel_post).
 *
 * Архитектура скопирована с transcriptPostRepository.ts.
 * Векторные операции (embedding, cosine similarity) идут через raw SQL,
 * как в nataliaPostRepository.ts — Prisma не поддерживает тип vector.
 */

import { prisma } from '../db/client';
import type { SimilarityMatch, DuplicateOfType } from '../services/shared/deduplication.types';
import type { TranscriptPostStatus } from '../shared/types/transcript.types';
import type {
  CreateNataliaChannelPostInput,
  NataliaChannelPostData,
} from '../shared/types/nataliaChannelPost.types';

export async function createNataliaChannelPost(
  data: CreateNataliaChannelPostInput
): Promise<NataliaChannelPostData> {
  return prisma.nataliaChannelPost.create({
    data: {
      text: data.text,
      mainIdea: data.mainIdea,
      attemptNumber: data.attemptNumber,
    },
  });
}

export async function updateEmbedding(
  id: string,
  embedding: number[]
): Promise<void> {
  const vectorLiteral = `[${embedding.join(',')}]`;

  await prisma.$executeRaw`
    UPDATE "NataliaChannelPost"
    SET embedding = ${vectorLiteral}::vector
    WHERE id = ${id}
  `;
}

/**
 * Помечает NataliaChannelPost как дубль.
 * @param id — ID поста
 * @param duplicateOfType — тип источника дубля (или 'natalia_relevance')
 * @param duplicateOfId — ID источника дубля (пустая строка для 'natalia_relevance')
 * @param similarity — значение similarity
 */
export async function markAsDuplicate(
  id: string,
  duplicateOfType: DuplicateOfType,
  duplicateOfId: string,
  similarity: number
): Promise<void> {
  await prisma.nataliaChannelPost.update({
    where: { id },
    data: {
      status: 'DUPLICATE',
      duplicateOfType,
      duplicateOfId,
      similarity,
    },
  });
}

export async function updateSimilarity(
  id: string,
  similarity: number
): Promise<void> {
  await prisma.nataliaChannelPost.update({
    where: { id },
    data: { similarity },
  });
}

export async function updateStatus(
  id: string,
  status: TranscriptPostStatus
): Promise<void> {
  await prisma.nataliaChannelPost.update({
    where: { id },
    data: { status },
  });
}

/**
 * Находит похожие NataliaChannelPost для дедупликации.
 *
 * Проверяет только посты со статусом SENT — черновики (REJECTED) не участвуют в дедупликации.
 *
 * @param embedding — вектор для сравнения
 * @param threshold — минимальная similarity (0 — вернуть всё)
 * @returns совпадения, отсортированные по similarity DESC
 */
export async function findSimilarNataliaChannelPosts(
  embedding: number[],
  threshold: number
): Promise<SimilarityMatch[]> {
  const vectorLiteral = `[${embedding.join(',')}]`;

  const rows = await prisma.$queryRaw<Array<{ id: string; similarity: number }>>`
    SELECT
      id,
      (1 - (embedding <=> ${vectorLiteral}::vector)) AS similarity
    FROM "NataliaChannelPost"
    WHERE embedding IS NOT NULL
      AND status = 'SENT'
      AND (1 - (embedding <=> ${vectorLiteral}::vector)) >= ${threshold}
    ORDER BY similarity DESC
  `;

  return rows.map((row) => ({
    id: row.id,
    similarity: Number(row.similarity),
  }));
}

/**
 * Все SENT-посты канала (без привязки к транскрипции).
 * Используются для блока «уже раскрытые темы» в промпте.
 */
export async function getSentPosts(): Promise<NataliaChannelPostData[]> {
  return prisma.nataliaChannelPost.findMany({
    where: { status: 'SENT' },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * MainIdea всех раскрытых тем: SENT + DUPLICATE.
 * Дубли тоже считаются раскрытыми — их mainIdea идёт в блок
 * «УЖЕ РАСКРЫТЫЕ ТЕМЫ», чтобы генерация не возвращалась к той же теме.
 * REJECTED-черновики (не отправлялись) раскрытыми не считаются.
 */
export async function getRevealedMainIdeas(): Promise<string[]> {
  const posts = await prisma.nataliaChannelPost.findMany({
    where: { status: { in: ['SENT', 'DUPLICATE'] } },
    orderBy: { createdAt: 'asc' },
    select: { mainIdea: true },
  });
  return posts.map((p) => p.mainIdea);
}

export async function getNataliaChannelPostById(
  id: string
): Promise<NataliaChannelPostData | null> {
  return prisma.nataliaChannelPost.findUnique({
    where: { id },
  });
}

export async function updateNataliaChannelPostText(
  id: string,
  text: string
): Promise<NataliaChannelPostData> {
  return prisma.nataliaChannelPost.update({
    where: { id },
    data: { text },
  });
}
