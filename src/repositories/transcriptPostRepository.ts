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

/**
 * Находит похожие TranscriptPost через cosine similarity (pgvector).
 *
 * @param embedding — вектор для сравнения
 * @param threshold — минимальная similarity (0 — вернуть всё)
 * @param excludeIds — id постов, которые надо исключить (например, черновики текущей попытки)
 * @returns совпадения, отсортированные по similarity DESC
 */
export async function findSimilarPosts(
  embedding: number[],
  threshold: number,
  excludeIds: string[] = []
): Promise<SimilarityMatch[]> {
  const vectorLiteral = `[${embedding.join(',')}]`;

  const rows =
    excludeIds.length > 0
      ? await prisma.$queryRaw<Array<{ id: string; similarity: number }>>`
          SELECT
            id,
            (1 - (embedding <=> ${vectorLiteral}::vector)) AS similarity
          FROM "TranscriptPost"
          WHERE embedding IS NOT NULL
            AND id != ALL(${excludeIds}::text[])
            AND (1 - (embedding <=> ${vectorLiteral}::vector)) >= ${threshold}
          ORDER BY similarity DESC
        `
      : await prisma.$queryRaw<Array<{ id: string; similarity: number }>>`
          SELECT
            id,
            (1 - (embedding <=> ${vectorLiteral}::vector)) AS similarity
          FROM "TranscriptPost"
          WHERE embedding IS NOT NULL
            AND (1 - (embedding <=> ${vectorLiteral}::vector)) >= ${threshold}
          ORDER BY similarity DESC
        `;

  return rows.map((row) => ({
    id: row.id,
    similarity: Number(row.similarity),
  }));
}
