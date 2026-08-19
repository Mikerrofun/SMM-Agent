/**
 * Repository для TranscriptPost — постов, сгенерированных из транскрипций.
 *
 * Векторные операции (embedding, cosine similarity) идут через raw SQL,
 * как в nataliaPostRepository.ts — Prisma не поддерживает тип vector.
 */

import { prisma } from '../db/client';
import type { SimilarityMatch } from '../services/idea/deduplication.types';
import type {
  CreateTranscriptPostInput,
  TranscriptPostData,
} from '../shared/types/transcript.types';

export async function createTranscriptPost(
  data: CreateTranscriptPostInput
): Promise<TranscriptPostData> {
  return prisma.transcriptPost.create({
    data: {
      transcriptId: data.transcriptId,
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
    UPDATE "TranscriptPost"
    SET embedding = ${vectorLiteral}::vector
    WHERE id = ${id}
  `;
}

export async function markAsDuplicate(
  id: string,
  similarity: number
): Promise<TranscriptPostData> {
  return prisma.transcriptPost.update({
    where: { id },
    data: {
      isDuplicate: true,
      similarity,
    },
  });
}

export async function updateSimilarity(
  id: string,
  similarity: number
): Promise<void> {
  await prisma.transcriptPost.update({
    where: { id },
    data: { similarity },
  });
}


export async function updateStatus(
  id: string,
  status: 'SENT' | 'REJECTED'
): Promise<void> {
  await prisma.transcriptPost.update({
    where: { id },
    data: { status },
  });
}


export async function getSentPosts(
  transcriptId: string
): Promise<TranscriptPostData[]> {
  return prisma.transcriptPost.findMany({
    where: {
      transcriptId,
      status: 'SENT',
    },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * Находит похожие TranscriptPost через cosine similarity (pgvector).
 *
 * Проверяет только посты со статусом SENT — черновики (REJECTED) не участвуют в дедупликации.
 *
 * @param embedding — вектор для сравнения
 * @param threshold — минимальная similarity (0 — вернуть всё)
 * @returns совпадения, отсортированные по similarity DESC
 */
export async function findSimilarPosts(
  embedding: number[],
  threshold: number
): Promise<SimilarityMatch[]> {
  const vectorLiteral = `[${embedding.join(',')}]`;

  const rows = await prisma.$queryRaw<Array<{ id: string; similarity: number }>>`
    SELECT
      id,
      (1 - (embedding <=> ${vectorLiteral}::vector)) AS similarity
    FROM "TranscriptPost"
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


export async function getTranscriptPostById(
  id: string
): Promise<TranscriptPostData | null> {
  return prisma.transcriptPost.findUnique({
    where: { id },
  });
}



export async function updateTranscriptPostText(
  id: string,
  text: string
): Promise<TranscriptPostData> {
  return prisma.transcriptPost.update({
    where: { id },
    data: { text },
  });
}
