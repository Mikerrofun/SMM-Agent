import {
  getNewIdeasWithEmbeddings,
  findSimilarIdeas,
  markAsDuplicate,
  updateMaxSimilarity,
} from '../../repositories/ideaRepository';
import { findSimilarNataliaPosts } from '../../repositories/nataliaPostRepository';
import { withRetry } from '../../shared/utils/retry';
import { SIMILARITY_THRESHOLD, DEDUPLICATION_RETRY_CONFIG } from './deduplication.config';
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

      await withRetry(async () => {
        const allSimilarIdeas = await findSimilarIdeas(
          embeddingArray,
          0,
          idea.id
        );

        const allSimilarPosts = await findSimilarNataliaPosts(
          embeddingArray,
          0
        );

        const bestIdeaMatch = allSimilarIdeas[0];
        const bestPostMatch = allSimilarPosts[0];

        let maxSimilarity = 0;
        let isDuplicate = false;
        let duplicateSource: 'idea' | 'nataliaPost' | null = null;
        let duplicateId: string | null = null;

        if (bestIdeaMatch && bestIdeaMatch.similarity > maxSimilarity) {
          maxSimilarity = bestIdeaMatch.similarity;
          if (maxSimilarity >= SIMILARITY_THRESHOLD) {
            isDuplicate = true;
            duplicateSource = 'idea';
            duplicateId = bestIdeaMatch.id;
          }
        }

        if (bestPostMatch && bestPostMatch.similarity > maxSimilarity) {
          maxSimilarity = bestPostMatch.similarity;
          if (maxSimilarity >= SIMILARITY_THRESHOLD) {
            isDuplicate = true;
            duplicateSource = 'nataliaPost';
            duplicateId = bestPostMatch.id;
          }
        }

        if (isDuplicate && duplicateSource && duplicateId) {
          await markAsDuplicate(
            idea.id,
            duplicateSource,
            duplicateId,
            maxSimilarity
          );

          stats.duplicates++;
          if (duplicateSource === 'idea') {
            stats.duplicatesWithIdeas++;
          } else {
            stats.duplicatesWithNataliaPosts++;
          }
        } else {
          if (maxSimilarity > 0) {
            await updateMaxSimilarity(idea.id, maxSimilarity);
          }
          stats.unique++;
        }
      }, DEDUPLICATION_RETRY_CONFIG);

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
