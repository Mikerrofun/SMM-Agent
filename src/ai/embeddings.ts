import { openai } from "../core/lib/openai";

/**
 * Создаёт embedding (вектор) из текста через OpenAI Embeddings API.
 * 
 * @param text — текст для векторизации (обычно mainIdea)
 * @returns массив из 1536 чисел (вектор)
 * @throws если текст пустой или API вернул ошибку
 */
export async function createEmbedding(text: string): Promise<number[]> {
  const trimmed = text.trim();

  if (trimmed.length === 0) {
    throw new Error("Cannot create embedding from empty text");
  }

  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: trimmed,
    encoding_format: "float",
  });

  const embedding = response.data[0]?.embedding;

  if (!embedding || embedding.length === 0) {
    throw new Error("OpenAI returned empty embedding");
  }

  return embedding;
}
