import cron from "node-cron";
import { Context } from "grammy";
import { bot } from "../bot";
import { handleRunPipelineCommand, logPipelineStats } from "../bot/commands/runPipeline";
import type { PipelineCommandResult } from "../services/pipeline/pipelineService.types";
import {
  getSubscriberChatIds,
  sendMessageToChats,
} from "../shared/telegram/subscribers";
import { CommandCancelledError } from "../shared/utils/CommandManager/CommandManager.errors";

const SUBSCRIBER_CHAT_IDS = getSubscriberChatIds();

// Первый ID в списке — главный админ, который получает детальные отчёты о пайплайне
const ADMIN_CHAT_ID = SUBSCRIBER_CHAT_IDS[0];

const CRON_ENABLED = process.env.CRON_ENABLED !== "false"; 
const CRON_SCHEDULE = process.env.CRON_SCHEDULE || "50 6 * * 2,4"; // По умолчанию: вт и чт в 9:50 MSK (6:50 UTC)


function createCronContext(chatId: string): Context {
  const adminId = Number(chatId);

  return {
    api: bot.api,
    from: { id: adminId },
    chat: { id: adminId },
    reply: async (text: string, options?: Parameters<Context["reply"]>[1]) => {
      return await bot.api.sendMessage(chatId, text, options);
    },
  } as unknown as Context;
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

  let pipelineResult: PipelineCommandResult | null = null;

  try {
    const dayOfWeek = new Date().toLocaleDateString("ru-RU", {
      weekday: "long",
      timeZone: "Europe/Moscow"
    });

    console.log(`[CRON] 📢 Отправляем уведомление о начале подписчикам...`);
    // Админ (первый в списке) получает стартовое сообщение от execute —
    // со статусом пайплайна и кнопкой отмены, поэтому в рассылке ему дубликат не нужен
    const startTargets = getSubscriberChatIds().filter((id) => id !== ADMIN_CHAT_ID);

    if (startTargets.length > 0) {
      await sendMessageToChats(
        bot.api,
        startTargets,
        `🤖 Автоматический запуск pipeline\n\n` +
        `📅 ${dayOfWeek}\n` +
        `⏰ ${moscowTime}\n\n` +
        `⏳ Начинаю обработку...`,
        { parse_mode: "Markdown" }
      );
    }

    // Запускаем пайплайн (отчёт будет отправлен через ctx только первому,
    // остальным подписчикам — рассылкой внутри handleRunPipelineCommand)
    const ctx = createCronContext(ADMIN_CHAT_ID);
    pipelineResult = await handleRunPipelineCommand(ctx);

    // Прогон отменён (админом через кнопку или по таймауту) — не пугаем
    // подписчиков «критической ошибкой»: уведомление об отмене рассылает runPipeline
    if (pipelineResult?.cancelled) {
      console.log("[CRON] 🚫 Прогон отменён (админом или по таймауту)");
      return;
    }
  } catch (error) {
    if (error instanceof CommandCancelledError) {
      console.log("[CRON] 🚫 Прогон отменён (админом или по таймауту)");
      // Уведомление об отмене остальным подписчикам уже отправлено runPipeline
      return;
    }

    console.error("\n" + "=".repeat(60));
    console.error("[CRON] ❌ Ошибка выполнения pipeline:", error);
    console.error("=".repeat(60) + "\n");

    // Ошибка вне execute (сам execute её не видит) — шлём ВСЕМ подписчикам, включая админа
    try {
      const errorMessage = error instanceof Error ? error.message : "Неизвестная ошибка";
      const shortError = errorMessage.length > 200 
        ? errorMessage.substring(0, 200) + "..." 
        : errorMessage;

      const errorTargets = getSubscriberChatIds();

      if (errorTargets.length > 0) {
        await sendMessageToChats(
          bot.api,
          errorTargets,
          "❌ *Критическая ошибка автоматического запуска*\n\n" +
          `\`\`\`\n${shortError}\n\`\`\`\n\n` +
          "Проверьте логи сервера для подробностей.",
          { parse_mode: "Markdown" }
        );
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
