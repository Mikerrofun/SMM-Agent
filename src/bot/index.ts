import { Bot } from "grammy";
import dotenv from "dotenv";
import { resolve } from "path";

// Загрузка переменных окружения из .env.local
if (typeof window === "undefined") {
  dotenv.config({ path: resolve(process.cwd(), ".env.local") });
}

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  throw new Error("TELEGRAM_BOT_TOKEN is not configured in .env.local");
}

export const bot = new Bot(token);

// Команда /start
bot.command("start", async (ctx) => {
  await ctx.reply(
    "👋 Привет! Я SMM Agent — твой персональный AI-ассистент для создания контента.\n\n" +
    "Я помогу тебе:\n" +
    "• Анализировать публикации конкурентов\n" +
    "• Генерировать идеи для новых постов\n" +
    "• Создавать готовые публикации в твоём стиле\n\n" +
    "Используй /help для списка команд."
  );
});

// Команда /help
bot.command("help", async (ctx) => {
  await ctx.reply(
    "📋 Доступные команды:\n\n" +
    "/start — начать работу\n" +
    "/help — показать это сообщение\n" +
    "/ideas — получить новые идеи для постов\n" +
    "/status — статус системы"
  );
});

// Команда /ideas (заглушка)
bot.command("ideas", async (ctx) => {
  await ctx.reply(
    "🔄 Функция генерации идей скоро будет доступна!\n\n" +
    "Система будет анализировать каналы конкурентов каждый вторник и четверг в 10:00."
  );
});

// Команда /status
bot.command("status", async (ctx) => {
  await ctx.reply("✅ Бот работает нормально!");
});

// Обработка ошибок
bot.catch((error) => {
  console.error("Telegram bot error:", error);
});

// Функция для запуска бота (long polling)
export async function startBot() {
  console.log("🤖 Starting Telegram bot...");
  await bot.start();
  console.log("✅ Telegram bot is running");
}

// Функция для остановки бота
export async function stopBot() {
  console.log("🛑 Stopping Telegram bot...");
  await bot.stop();
  console.log("✅ Telegram bot stopped");
}
