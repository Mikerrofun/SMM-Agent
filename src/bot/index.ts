import { Bot } from "grammy";
import dotenv from "dotenv";
import { resolve } from "path";
import {
  handleIdeasCommand,
  handleGeneratePostCallback,
  handleRunPipelineCommand,
  handleRunPipelineCallback,
} from "./commands";

if (typeof window === "undefined") {
  dotenv.config({ path: resolve(process.cwd(), ".env.local") });
}

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  throw new Error("TELEGRAM_BOT_TOKEN is not configured in .env.local");
}

export const bot = new Bot(token);

bot.command("start", async (ctx) => {
  await ctx.reply(
    "👋 Привет! Я SMM Agent — твой персональный AI-ассистент для создания контента.\n\n" +
    "Я помогу тебе:\n" +
    "• Анализировать публикации конкурентов\n" +
    "• Генерировать идеи для новых постов\n" +
    "• Создавать готовые публикации в твоём стиле\n\n" +
    "Используй /help для списка команд или /ideas чтобы получить новые идеи."
  );
});

bot.command("help", async (ctx) => {
  await ctx.reply(
    "📋 *Доступные команды:*\n\n" +
    "/start — начать работу с ботом\n" +
    "/help — показать это сообщение\n" +
    "/ideas — получить новые идеи для постов\n" +
    "/run\\_pipeline — запустить генерацию идей\n" +
    "/status — статус системы\n\n" +
    "*Как это работает?*\n\n" +
    "1️⃣ Используй /run\\_pipeline для запуска анализа каналов конкурентов и генерации идей\n" +
    "2️⃣ После завершения получи идеи командой /ideas\n" +
    "3️⃣ Выбери понравившуюся идею и сгенерируй пост",
    { parse_mode: "Markdown" }
  );
});

bot.command("ideas", handleIdeasCommand);
bot.command("run_pipeline", handleRunPipelineCommand);

bot.command("status", async (ctx) => {
  await ctx.reply("✅ Бот работает нормально!");
});

bot.callbackQuery(/^generate_post:/, handleGeneratePostCallback);
bot.callbackQuery("run_pipeline", handleRunPipelineCallback);

bot.catch((error) => {
  const err = error.error;
  console.error("Telegram bot error:", err);
  
  if (error.ctx) {
    console.error("Error context:", {
      update_id: error.ctx.update.update_id,
      chat_id: error.ctx.chat?.id,
      user_id: error.ctx.from?.id,
    });
  }
});

export async function startBot() {
  console.log("🤖 Starting Telegram bot...");
  await bot.start();
  console.log("✅ Telegram bot is running");
  console.log("📱 Available commands: /start, /help, /ideas, /run_pipeline, /status");
}

export async function stopBot() {
  console.log("🛑 Stopping Telegram bot...");
  await bot.stop();
  console.log("✅ Telegram bot stopped");
}
