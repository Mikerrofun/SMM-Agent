/**
 * Repository для ClientTranscript — транскрипций встреч с клиентами.
 */

import { prisma } from '../db/client';
import type {
  ClientTranscriptData,
  CreateTranscriptInput,
  TranscriptPostData,
} from '../shared/types/transcript.types';

export async function createTranscript(
  data: CreateTranscriptInput
): Promise<ClientTranscriptData> {
  return prisma.clientTranscript.create({
    data: {
      text: data.text,
      fileName: data.fileName ?? null,
    },
  });
}

export async function getTranscriptById(
  id: string
): Promise<(ClientTranscriptData & { posts: TranscriptPostData[] }) | null> {
  const transcript = await prisma.clientTranscript.findUnique({
    where: { id },
    include: {
      posts: {
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  return transcript ?? null;
}

export async function markAsProcessed(
  id: string,
  processedAt: Date = new Date()
): Promise<void> {
  await prisma.clientTranscript.update({
    where: { id },
    data: { processedAt },
  });
}

export async function getRecentTranscripts(
  limit = 10
): Promise<ClientTranscriptData[]> {
  return prisma.clientTranscript.findMany({
    orderBy: { uploadedAt: 'desc' },
    take: limit,
  });
}
