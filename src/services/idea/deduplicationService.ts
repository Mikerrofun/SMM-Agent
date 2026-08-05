/**
 * Сервис дедупликации идей через векторный поиск.
 * 
 * Проверяет NEW идеи на похожесть с:
 * 1. Существующими идеями (NEW + SENT статусы)
 * 2. Постами Натальи (NataliaPost)
 * 
 * При similarity ≥ 0.85 идея помечается как DUPLICATE с метаданными.
 */

import {
  getNewIdeasWithEmbeddings,
  findSimilarIdeas,
  markAsDuplicate,
} from '../../repositories/ideaRepository';
import { findSimilarNataliaPosts } from '../../repositories/nataliaPostRepository';
import { SIMILARITY_THRESHOLD } from './deduplication.config';
import type { DeduplicationStats, DeduplicateIdeasOptions } from './deduplication.types';

export async function deduplicateIdeas(
  options?: DeduplicateIdeasOptions
): Promise<DeduplicationStats> {
  const { onProgress } = options ?? {};

  const stats: DeduplicationStats = {
    total: 0,
    unique: 0,
    duplicates: 0,
    duplicatesWithIdeas: 0,
    duplicatesWithNataliaPosts: 0,
    failed: 0,
    failedItems: [],
  };

  const ideas = await getNewIdeasWithEmbeddings();
  stats.total = ideas.length;

  if (ideas.length === 0) {
    return stats;
  }

  for (let i = 0; i < ideas.length; i++) {
    const idea = ideas[i];

    try {
      const embeddingArray = parseEmbeddingString(idea.embedding);

      const similarIdeas = await findSimilarIdeas(
        embeddingArray,
        SIMILARITY_THRESHOLD,
        idea.id
      );

      if (similarIdeas.length > 0) {
        const match = similarIdeas[0];
        
        await markAsDuplicate(
          idea.id,
          'idea',
          match.id,
          match.similarity
        );

        stats.duplicates++;
        stats.duplicatesWithIdeas++;
        onProgress?.(i + 1, ideas.length);
        continue;
      }

      const similarPosts = await findSimilarNataliaPosts(
        embeddingArray,
        SIMILARITY_THRESHOLD
      );

      if (similarPosts.length > 0) {
        const match = similarPosts[0];
        
        await markAsDuplicate(
          idea.id,
          'nataliaPost',
          match.id,
          match.similarity
        );

        stats.duplicates++;
        stats.duplicatesWithNataliaPosts++;
        onProgress?.(i + 1, ideas.length);
        continue;
      }

      stats.unique++;

    } catch (error) {
      stats.failed++;
      const message = error instanceof Error ? error.message : String(error);
      
      stats.failedItems.push({
        id: idea.id,
        error: message,
      });
    }

    onProgress?.(i + 1, ideas.length);
  }

  return stats;
}

function parseEmbeddingString(embeddingStr: string): number[] {
  try {
    const cleaned = embeddingStr.trim();
    const embedding = JSON.parse(cleaned) as number[];

    if (!Array.isArray(embedding) || embedding.length === 0) {
      throw new Error('Embedding is not a valid array');
    }

    return embedding;
  } catch (error) {
    throw new Error(
      `Failed to parse embedding string: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}
