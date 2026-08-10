import cron from "node-cron";
import { Context } from "grammy";
import { bot } from "../bot";
import { handleRunPipelineCommand } from "../bot/commands/runPipeline";

const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const CRON_ENABLED = process.env.CRON_ENABLED !== "false"; 
const CRON_SCHEDULE = process.env.CRON_SCHEDULE || "50 6 * * 2,4"; // По умолчанию: вт и чт в 9:50 MSK (6:50 UTC)


function createCronContext(chatId: string): Context {
  return {
    api: bot.api,
    reply: async (text: string, options?: any) => {
      return await bot.api.sendMessage(chatId, text, options);
    },
  } as Context;
}


async function runScheduledPipeline(): Promise<void> {
  const timestamp = new Date().toISOString();
  const moscowTime = new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });
  
  console.log(`\n${"=".repeat(60)}`);
  console.log(`[CRON] 🚀 Автоматический запуск pipeline`);
  console.log(`[CRON] ⏰ UTC: ${timestamp}`);
  console.log(`[CRON] ⏰ MSK: ${moscowTime}`);
  console.log(`${"=".repeat(60)}\n`);

  if (!ADMIN_CHAT_ID) {
    console.error("[CRON] ❌ ADMIN_CHAT_ID не настроен, пропускаем запуск");
    return;
  }

  try {
    const dayOfWeek = new Date().toLocaleDateString("ru-RU", {
      weekday: "long",
      timeZone: "Europe/Moscow"
    });

    await bot.api.sendMessage(
      ADMIN_CHAT_ID,
      `🤖 Автоматический запуск pipeline\n\n` +
      `📅 ${dayOfWeek}\n` +
      `⏰ ${moscowTime}\n\n` +
      `⏳ Начинаю обработку...`,
      { parse_mode: "Markdown" }
    );

    const ctx = createCronContext(ADMIN_CHAT_ID);
    
    await handleRunPipelineCommand(ctx);

    console.log("\n" + "=".repeat(60));
    console.log("[CRON] ✅ Автоматический запуск завершен");
    console.log("=".repeat(60) + "\n");

  } catch (error) {
    console.error("\n" + "=".repeat(60));
    console.error("[CRON] ❌ Ошибка выполнения pipeline:", error);
    console.error("=".repeat(60) + "\n");

    try {
      const errorMessage = error instanceof Error ? error.message : "Неизвестная ошибка";
      const shortError = errorMessage.length > 200 
        ? errorMessage.substring(0, 200) + "..." 
        : errorMessage;

      await bot.api.sendMessage(
        ADMIN_CHAT_ID,
        "❌ *Критическая ошибка автоматического запуска*\n\n" +
        `\`\`\`\n${shortError}\n\`\`\`\n\n` +
        "Проверьте логи сервера для подробностей.",
        { parse_mode: "Markdown" }
      );
    } catch (notifyError) {
      console.error("[CRON] ❌ Не удалось отправить уведомление об ошибке:", notifyError);
    }
  }
}


export function initScheduler(): void {
  if (!CRON_ENABLED) {
    console.log("[CRON] ⏸️  Планировщик отключен через CRON_ENABLED");
    return;
  }

  if (!ADMIN_CHAT_ID) {
    console.log("\n" + "=".repeat(60));
    console.log("[CRON] ⚠️  ВНИМАНИЕ: ADMIN_CHAT_ID не настроен!");
    console.log("[CRON] ⚠️  Автоматические запуски будут пропускаться");
    console.log("[CRON] 💡 Добавьте ADMIN_CHAT_ID в переменные окружения");
    console.log("=".repeat(60) + "\n");
  }

  console.log("\n" + "=".repeat(60));
  console.log("[CRON] ⚙️  Инициализация планировщика задач");
  console.log(`[CRON] 📅 Расписание: ${CRON_SCHEDULE}`);
  console.log(`[CRON] 🌍 Часовой пояс: UTC (сервер работает в UTC)`);
  console.log(`[CRON] 🕐 Текущее время UTC: ${new Date().toISOString()}`);
  console.log(`[CRON] 🕐 Текущее время MSK: ${new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })}`);
  
  if (ADMIN_CHAT_ID) {
    console.log(`[CRON] 📱 Уведомления: включены (chat_id: ${ADMIN_CHAT_ID})`);
  } else {
    console.log("[CRON] 📱 Уведомления: отключены (ADMIN_CHAT_ID не настроен)");
  }
  
  console.log("=".repeat(60) + "\n");

  const task = cron.schedule(
    CRON_SCHEDULE,
    () => {
      void runScheduledPipeline();
    },
    {
      timezone: "UTC", 
    }
  );

  console.log("[CRON] ✅ Планировщик успешно запущен");
  console.log("[CRON] ⏰ Следующий запуск будет согласно расписанию\n");

  process.once("SIGINT", () => {
    console.log("\n[CRON] 🛑 Получен SIGINT, останавливаем планировщик...");
    task.stop();
  });

  process.once("SIGTERM", () => {
    console.log("\n[CRON] 🛑 Получен SIGTERM, останавливаем планировщик...");
    task.stop();
  });
}

export async function runPipelineManually(): Promise<void> {
  console.log("[CRON] 🧪 Ручной запуск pipeline для тестирования");
  await runScheduledPipeline();
}
