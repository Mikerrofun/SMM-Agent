import OpenAI from "openai";
import dotenv from "dotenv";
import { resolve } from "path";

// Загрузка переменных окружения из .env.local (приоритет) или .env
if (typeof window === "undefined") {
  dotenv.config({ path: resolve(process.cwd(), ".env.local") });
  dotenv.config({ path: resolve(process.cwd(), ".env") }); // fallback
}

const apiKey = process.env.OPENAI_API_KEY;

if (!apiKey) {
  throw new Error("OPENAI_API_KEY is not configured in .env or .env.local");
}

// Получение базового URL (для OpenAI-compatible хабов, например Claude Hub)
const baseURL = process.env.OPENAI_BASE_URL;

// Инициализация клиента OpenAI
export const openai = new OpenAI({
  apiKey,
  baseURL, // Если не задан, используется дефолтный OpenAI URL
});

// Экспорт модели по умолчанию для тестирования (быстрая, дешевая)
export const DEFAULT_MODEL = "gpt-4o-mini";

// Экспорт модели для продакшена (более мощная, если нужна)
export const PRODUCTION_MODEL = "gpt-5.6-sol";
