import type { Context } from "grammy";
import { runFullPipeline } from "../../services/pipeline/pipelineService";
import type { PipelineResult, PipelineCommandResult } from "../../services/pipeline/pipelineService.types";
import { formatPipelineReport, formatDuration, pluralizeNewIdea } from "../../shared/utils/pipelineReportFormatter";
import { withRetry } from "../../shared/utils/retry";

let isPipelineRunning = false;
const PIPELINE_TIMEOUT_MS = 30 * 60 * 1000;

// Telegram ограничивает частоту editMessageText (~1 раз в 2-3 секунды на сообщение),
// иначе ловим 429 Too Many Requests
const STATUS_EDIT_INTERVAL_MS = 3000;
const TELEGRAM_EDIT_RETRY = { maxAttempts: 4, delayMs: 3000, backoffFactor: 1.5 } as const;

type StatusMessage = { chat: { id: number }; message_id: number };

async function editStatusMessageWithRetry(
  ctx: Context,
  statusMessage: StatusMessage,
  text: string,
  options?: { parse_mode?: "HTML" }
): Promise<void> {
  await withRetry(
    () =>
      ctx.api.editMessageText(
        statusMessage.chat.id,
        statusMessage.message_id,
        text,
        options
      ),
    TELEGRAM_EDIT_RETRY
  );
}

/**
 * Пытается отредактировать статусное сообщение, при неудаче — отправляет новое.
 * Гарантирует, что финальный отчёт дойдёт до чата даже при устойчивом 429.
 */
async function editOrSend(
  ctx: Context,
  statusMessage: StatusMessage | null,
  text: string,
  options?: { parse_mode?: "HTML" }
): Promise<void> {
  if (statusMessage) {
    try {
      await editStatusMessageWithRetry(ctx, statusMessage, text, options);
      return;
    } catch (error) {
      console.error("Failed to edit status message, falling back to sendMessage:", error);
    }
  }
  await ctx.reply(text, options);
}

export function logPipelineStats(result: PipelineResult, duration: number): void {
  console.log("\n📊 СТАТИСТИКА ВЫПОЛНЕНИЯ:");
  console.log("━".repeat(60));
  console.log("\n📡 Парсинг каналов:");
  console.log(`   • Обработано каналов: ${result.parsing.totalChannels}`);
  console.log(`   • Успешно: ${result.parsing.successfulChannels}`);
  console.log(`   • Новых постов: ${result.parsing.savedPosts}`);
  if (result.parsing.skippedPosts > 0) {
    console.log(`   • Пропущено (дубли): ${result.parsing.skippedPosts}`);
  }
  
  console.log("\n💡 Генерация идей:");
  console.log(`   • Обработано постов: ${result.ideas.total}`);
  console.log(`   • Создано идей: ${result.ideas.succeeded}`);
  if (result.ideas.failed > 0) {
    console.log(`   • Ошибок: ${result.ideas.failed}`);
  }
  
  console.log("\n🔍 Дедупликация:");
  console.log(`   • Проверено всего идей: ${result.deduplication.total}`);
  console.log(`   • Новых из прогона: ${result.ideas.succeeded}`);
  console.log(`   • Уникальных из прогона: ${result.acceptedIdeasFromRun}`);
  if (result.deduplication.duplicates > 0) {
    console.log(`   • Дубликатов найдено: ${result.deduplication.duplicates}`);
  }
  
  console.log("\n" + "━".repeat(60));
  console.log(`⏱️  Время выполнения: ${formatDuration(duration)}`);
  console.log("━".repeat(60) + "\n");
}

export async function handleRunPipelineCommand(ctx: Context): Promise<PipelineCommandResult> {
  let statusMessage: StatusMessage | null = null;
  let lastStatusEditAt = 0;

  try {
    if (isPipelineRunning) {
      await ctx.reply(
        "⚠️ Пайплайн уже выполняется. Дождитесь завершения текущего прогона."
      );
      return { success: false, error: "Pipeline already running" };
    }

    isPipelineRunning = true;

    statusMessage = await ctx.reply(
      "🚀 Запуск пайплайна генерации идей...\n\n" +
      "⏳ Инициализация..."
    );

    const startTime = Date.now();

    const pipelinePromise = runFullPipeline(async (stage, status) => {
      if (!statusMessage) return;

      // Троттлинг: редактируем не чаще раза в STATUS_EDIT_INTERVAL_MS,
      // чтобы не упереться в rate limit Telegram
      const now = Date.now();
      if (now - lastStatusEditAt < STATUS_EDIT_INTERVAL_MS) return;
      lastStatusEditAt = now;

      try {
        await editStatusMessageWithRetry(
          ctx,
          statusMessage,
          `🚀 Пайплайн генерации идей\n\n${status}`
        );
      } catch (error) {
        console.error("Failed to update status message:", error);
      }
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error("Превышено время выполнения (30 минут)")),
        PIPELINE_TIMEOUT_MS
      );
    });

    const result = await Promise.race([pipelinePromise, timeoutPromise]);
    const duration = Math.round((Date.now() - startTime) / 1000);

    logPipelineStats(result, duration);

    const finalMessage = formatPipelineReport(result, duration);

    // Финальный отчёт: withRetry + fallback на sendMessage, чтобы он точно пришёл
    await editOrSend(ctx, statusMessage, finalMessage, { parse_mode: "HTML" });

    return { success: true, data: result };

  } catch (error) {
    console.error("Error in /run_pipeline command:", error);
    
    const errorMessage = error instanceof Error ? error.message : "Неизвестная ошибка";
    
    try {
      const shortError = errorMessage.length > 200 
        ? errorMessage.substring(0, 200) + "..." 
        : errorMessage;

      const errorMsg = 
        "❌ Ошибка выполнения пайплайна\n\n" +
        shortError + "\n\n" +
        "Проверьте логи для подробностей.";

      await editOrSend(ctx, statusMessage, errorMsg);
    } catch (replyError) {
      console.error("Failed to send error message:", replyError);
      
      try {
        const fallbackMsg = "❌ Ошибка выполнения пайплайна. Проверьте логи.";
        await editOrSend(ctx, statusMessage, fallbackMsg);
      } catch (fallbackError) {
        console.error("Failed to send fallback message:", fallbackError);
      }
    }

    return { success: false, error: errorMessage };
  } finally {
    isPipelineRunning = false;
  }
}

export async function handleRunPipelineCallback(ctx: Context): Promise<void> {
  try {
    await ctx.answerCallbackQuery();
    await handleRunPipelineCommand(ctx);
  } catch (error) {
    console.error("Error in run_pipeline callback:", error);
    try {
      await ctx.answerCallbackQuery({
        text: "❌ Произошла ошибка",
      });
    } catch (answerError) {
      console.error("Failed to answer callback query:", answerError);
    }
  }
}

// Экспортируем для использования в других модулях
export { formatPipelineReport, formatDuration, pluralizeNewIdea };
