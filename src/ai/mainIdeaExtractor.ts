/**
 * Универсальный AI-модуль для извлечения главной мысли (mainIdea) из текста.
 *
 * Используется для NataliaPost, а в дальнейшем — для Idea и CompetitorPost.
 * Логика вызова LLM инкапсулирована здесь; retry и batch-обработка живут
 * на уровне сервиса (src/services/nataliaPost/mainIdeaProcessor.ts).
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { openai, DEFAULT_MODEL } from "../core/lib/openai";

const MAX_TOKENS = 200;
const TEMPERATURE = 0.3;

const PROMPT_PATH = resolve(
  process.cwd(),
  "src/prompts/extract-main-idea.md"
);

let cachedPrompt: string | null = null;

function getSystemPrompt(): string {
  if (cachedPrompt === null) {
    cachedPrompt = readFileSync(PROMPT_PATH, "utf-8");
  }
  return cachedPrompt;
}

/**
 * Извлекает главную мысль из текста через LLM.
 *
 * @param text — исходный текст поста
 * @returns краткий пересказ (3-4 предложения)
 * @throws пробрасывает ошибку наверх для retry на уровне сервиса
 */
export async function extractMainIdea(text: string): Promise<string> {
  const trimmed = text?.trim() ?? "";

  if (trimmed.length === 0) {
    throw new Error("Cannot extract mainIdea from empty text");
  }

  const systemPrompt = getSystemPrompt();

  const response = await openai.chat.completions.create({
    model: DEFAULT_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: trimmed },
    ],
    max_tokens: MAX_TOKENS,
    temperature: TEMPERATURE,
  });

  const mainIdea = response.choices[0]?.message?.content?.trim() ?? "";

  if (mainIdea.length === 0) {
    throw new Error("LLM returned empty mainIdea");
  }

  return mainIdea;
}
