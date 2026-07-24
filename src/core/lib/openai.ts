import OpenAI from "openai";
import dotenv from "dotenv";
import { resolve } from "path";

// Загрузка переменных окружения из .env.local
if (typeof window === "undefined") {
  dotenv.config({ path: resolve(process.cwd(), ".env.local") });
}

const apiKey = process.env.OPENAI_API_KEY;

if (!apiKey) {
  throw new Error("OPENAI_API_KEY is not configured in .env.local");
}

// Инициализация клиента OpenAI
export const openai = new OpenAI({
  apiKey,
});

// Экспорт модели по умолчанию для тестирования (дешевая)
export const DEFAULT_MODEL = "gpt-3.5-turbo";

// Экспорт модели для продакшена (более мощная)
export const PRODUCTION_MODEL = "gpt-4o";
