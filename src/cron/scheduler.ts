import cron from "node-cron";
import { Context } from "grammy";
import { bot } from "../bot";
import { handleRunPipelineCommand, logPipelineStats } from "../bot/commands/runPipeline";
import type { PipelineResult } from "../services/pipeline/pipelineService.types";
import { formatPipelineReport } from "../shared/utils/pipelineReportFormatter";

const SUBSCRIBER_CHAT_IDS = process.env.SUBSCRIBER_CHAT_IDS
  ?.split(',')
  .map(id => id.trim())
  .filter(id => id.length > 0) || [];

// Первый ID в списке — главный админ, который получает детальные отчёты о пайплайне
const ADMIN_CHAT_ID = SUBSCRIBER_CHAT_IDS[0];

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
  const startTime = Date.now();
  const startTimestamp = new Date().toISOString();
  const moscowTime = new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });
  
  console.log(`\n${"=".repeat(60)}`);
  console.log(`[CRON] 🚀 Автоматический запуск pipeline`);
  console.log(`[CRON] ⏰ UTC: ${startTimestamp}`);
  console.log(`[CRON] ⏰ MSK: ${moscowTime}`);
  console.log(`${"=".repeat(60)}\n`);
  
  if (!ADMIN_CHAT_ID || SUBSCRIBER_CHAT_IDS.length === 0) {
    console.error("[CRON] ❌ SUBSCRIBER_CHAT_IDS не настроен, пропускаем запуск");
    return;
  }

  console.log(`[CRON] 👥 Подписчиков: ${SUBSCRIBER_CHAT_IDS.length}`);

  let pipelineResult: { success: boolean; data?: PipelineResult; error?: string } | null = null;

  try {
    const dayOfWeek = new Date().toLocaleDateString("ru-RU", {
      weekday: "long",
      timeZone: "Europe/Moscow"
    });

    console.log(`[CRON] 📢 Отправляем уведомление о начале ВСЕМ подписчикам...`);
    for (const chatId of SUBSCRIBER_CHAT_IDS) {
      try {
        await bot.api.sendMessage(
          chatId,
          `🤖 Автоматический запуск pipeline\n\n` +
          `📅 ${dayOfWeek}\n` +
          `⏰ ${moscowTime}\n\n` +
          `⏳ Начинаю обработку...`,
          { parse_mode: "Markdown" }
        );
      } catch (error) {
        console.error(`[CRON] ❌ Ошибка отправки начального уведомления в ${chatId}:`, error);
      }
    }

    // Запускаем пайплайн (отчёт будет отправлен через ctx только первому)
    const ctx = createCronContext(ADMIN_CHAT_ID);
    pipelineResult = await handleRunPipelineCommand(ctx);

    // Если пайплайн успешен — отправляем финальный отчёт ВСЕМ ОСТАЛЬНЫМ подписчикам (кроме первого, он уже получил через ctx)
    if (pipelineResult?.success && pipelineResult.data) {
      const otherSubscribers = SUBSCRIBER_CHAT_IDS.slice(1);
      
      if (otherSubscribers.length > 0) {
        console.log(`\n[CRON] 📢 Отправляем финальный отчёт остальным подписчикам (${otherSubscribers.length})...`);
        
        const duration = Math.round((Date.now() - startTime) / 1000);
        const finalMessage = formatPipelineReport(pipelineResult.data, duration);

        for (const chatId of otherSubscribers) {
          try {
            await bot.api.sendMessage(chatId, finalMessage, { parse_mode: "HTML" });
            console.log(`[CRON] ✅ Финальный отчёт отправлен: ${chatId}`);
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.error(`[CRON] ❌ Ошибка отправки финального отчёта в ${chatId}:`, errorMsg);
          }
        }
      }
    }

  } catch (error) {
    console.error("\n" + "=".repeat(60));
    console.error("[CRON] ❌ Ошибка выполнения pipeline:", error);
    console.error("=".repeat(60) + "\n");

    // Отправляем ошибку ВСЕМ подписчикам
    try {
      const errorMessage = error instanceof Error ? error.message : "Неизвестная ошибка";
      const shortError = errorMessage.length > 200 
        ? errorMessage.substring(0, 200) + "..." 
        : errorMessage;

      for (const chatId of SUBSCRIBER_CHAT_IDS) {
        try {
          await bot.api.sendMessage(
            chatId,
            "❌ *Критическая ошибка автоматического запуска*\n\n" +
            `\`\`\`\n${shortError}\n\`\`\`\n\n` +
            "Проверьте логи сервера для подробностей.",
            { parse_mode: "Markdown" }
          );
        } catch (notifyError) {
          console.error(`[CRON] ❌ Не удалось отправить уведомление об ошибке в ${chatId}:`, notifyError);
        }
      }
    } catch (notifyError) {
      console.error("[CRON] ❌ Критическая ошибка при отправке уведомлений:", notifyError);
    }
  } finally {
    // Гарантированное логирование статистики
    const endTime = Date.now();
    const duration = Math.round((endTime - startTime) / 1000);
    const endTimestamp = new Date().toISOString();
    const endMoscowTime = new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });
    
    console.log("\n" + "=".repeat(60));
    console.log("[CRON] 🏁 Завершение автоматического запуска");
    console.log("=".repeat(60));
    
    if (pipelineResult?.success && pipelineResult.data) {
      // Используем общую функцию для логирования
      logPipelineStats(pipelineResult.data, duration);
      console.log("✅ Результат: УСПЕХ");
    } else if (pipelineResult?.error) {
      console.log(`\n❌ Результат: ОШИБКА - ${pipelineResult.error}`);
    } else {
      console.log(`\n⚠️  Результат: Статистика недоступна`);
    }
    
    console.log(`\n🕐 Начало (UTC): ${startTimestamp}`);
    console.log(`🕐 Конец  (UTC): ${endTimestamp}`);
    console.log(`🕐 Конец  (MSK): ${endMoscowTime}`);
    console.log("=".repeat(60) + "\n");
  }
}


export function initScheduler(): void {
  if (!CRON_ENABLED) {
    console.log("[CRON] ⏸️  Планировщик отключен через CRON_ENABLED");
    return;
  }

  if (!ADMIN_CHAT_ID || SUBSCRIBER_CHAT_IDS.length === 0) {
    console.log("\n" + "=".repeat(60));
    console.log("[CRON] ⚠️  ВНИМАНИЕ: SUBSCRIBER_CHAT_IDS не настроен!");
    console.log("[CRON] ⚠️  Автоматические запуски будут пропускаться");
    console.log("[CRON] 💡 Добавьте SUBSCRIBER_CHAT_IDS в переменные окружения");
    console.log("[CRON] 💡 Формат: SUBSCRIBER_CHAT_IDS=\"123456789,987654321\"");
    console.log("=".repeat(60) + "\n");
  }

  console.log("\n" + "=".repeat(60));
  console.log("[CRON] ⚙️  Инициализация планировщика задач");
  console.log(`[CRON] 📅 Расписание: ${CRON_SCHEDULE}`);
  console.log(`[CRON] 🌍 Часовой пояс: UTC (сервер работает в UTC)`);
  console.log(`[CRON] 🕐 Текущее время UTC: ${new Date().toISOString()}`);
  console.log(`[CRON] 🕐 Текущее время MSK: ${new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })}`);
  
  if (SUBSCRIBER_CHAT_IDS.length > 0) {
    console.log(`[CRON] 👥 Подписчиков: ${SUBSCRIBER_CHAT_IDS.length}`);
    console.log(`[CRON] 📱 Главный админ: ${ADMIN_CHAT_ID}`);
    console.log(`[CRON] 📱 Список подписчиков: ${SUBSCRIBER_CHAT_IDS.join(', ')}`);
  } else {
    console.log("[CRON] 📱 Рассылка: отключена (SUBSCRIBER_CHAT_IDS не настроен)");
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
