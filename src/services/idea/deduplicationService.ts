import {
  getNewIdeasWithEmbeddings,
  findSimilarIdeas,
  markAsDuplicate,
  updateMaxSimilarity,
} from '../../repositories/ideaRepository';
import { findSimilarNataliaPosts } from '../../repositories/nataliaPostRepository';
import { findSimilarPostsForIdeas } from '../../repositories/transcriptPostRepository';
import { withRetry } from '../../shared/utils/retry';
import { DEDUPLICATION_RETRY_CONFIG } from '../shared/deduplication.config';
import { resolveBestMatch } from '../shared/similarityResolver';
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
    duplicatesWithTranscriptPosts: 0,
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
          const [nataliaMatches, transcriptMatches, ideaMatches] = await Promise.all([
             findSimilarIdeas(embeddingArray, 0, idea.id),
             findSimilarNataliaPosts(embeddingArray, 0),
             findSimilarPostsForIdeas(embeddingArray, 0),
          ]);
        
          const { maxSimilarity, source, matchedId } = resolveBestMatch('idea', [
            { source: 'idea', matches: nataliaMatches },
            { source: 'nataliaPost', matches: transcriptMatches },
            { source: 'transcriptPost', matches: ideaMatches },
          ]);

        const isDuplicate = source !== null && matchedId !== null;

        if (isDuplicate && source && matchedId) {
          await markAsDuplicate(
            idea.id,
            source,
            matchedId,
            maxSimilarity
          );

          stats.duplicates++;
          if (source === 'idea') {
            stats.duplicatesWithIdeas++;
          } else if (source === 'nataliaPost') {
            stats.duplicatesWithNataliaPosts++;
          } else if (source === 'transcriptPost') {
            stats.duplicatesWithTranscriptPosts++;
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

