import type { Context } from "grammy";
import { runFullPipeline } from "../../services/pipeline/pipelineService";
import type { PipelineResult, PipelineCommandResult } from "../../services/pipeline/pipelineService.types";
import { formatPipelineReport, formatDuration, pluralizeNewIdea } from "../../shared/utils/pipelineReportFormatter";
import { withRetry } from "../../shared/utils/retry";
import { commandManager } from "../../shared/utils/CommandManager/CommandManager";
import { CommandCancelledError } from "../../shared/utils/CommandManager/CommandManager.errors";
import type { CommandStatusMessage } from "../../shared/utils/CommandManager/CommandManager.types";
import {
  PIPELINE_TIMEOUT_MS,
  STATUS_EDIT_INTERVAL_MS,
  TELEGRAM_EDIT_RETRY,
} from "./runPipeline.types";

/**
 * Редактирует существующее сообщение с автоматическими повторными попытками.
 * Используется для обновления статуса во время выполнения пайплайна.
 */
async function editStatusMessageWithRetry(
  ctx: Context,
  statusMessage: CommandStatusMessage,
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
 * Пытается отредактировать сообщение, при неудаче отправляет новое.
 * Используется для финального отчёта и сообщений об ошибках,
 */
async function editOrSend(
  ctx: Context,
  statusMessage: CommandStatusMessage | null,
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
  const execution = await commandManager.execute(
    ctx,
    "run_pipeline",
    {
      statusText: "🚀 Запуск пайплайна генерации идей...",
      // Глобальный запрет параллельного пайплайна (включая крон) —
      // заменяет прежний флаг isPipelineRunning
      singleton: true,
    },
    async (_ctx, { statusMessage }) => {
      const startTime = Date.now();
      let lastStatusEditAt = 0;

      const pipelinePromise = runFullPipeline(async (_stage, status) => {
        // После отмены отложенный edit не должен перезаписать «Команда отменена»
        if (commandManager.isCurrentCancelled()) return;

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

      // Таймаут не бросает исключение в race, а отменяет текущую команду:
      // abort прокатывается по checkCancelled в сервисах, пайплайн реально
      // останавливается, а GenerationRun получает CANCELLED
      const timeoutHandle = setTimeout(() => {
        commandManager.cancelCurrent("Превышено время выполнения (30 минут)");
      }, PIPELINE_TIMEOUT_MS);

      try {
        const result = await pipelinePromise;
        const duration = Math.round((Date.now() - startTime) / 1000);

        logPipelineStats(result, duration);

        const finalMessage = formatPipelineReport(result, duration);

        // Финальный отчёт: withRetry + fallback на sendMessage, чтобы он точно пришёл
        await editOrSend(ctx, statusMessage, finalMessage, { parse_mode: "HTML" });

        return { success: true, data: result };
      } catch (error) {
        // Отмену (кнопка или таймаут) обрабатывает execute — прокидываем дальше
        if (error instanceof CommandCancelledError) {
          throw error;
        }

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
        clearTimeout(timeoutHandle);
      }
    }
  );

  switch (execution?.status) {
    case "completed":
      return execution.value;
    case "cancelled":
      return { success: false, cancelled: true, error: "Pipeline cancelled" };
    case "already_running":
      return { success: false, error: "Pipeline already running" };
    default:
      return { success: false, error: "Command context is missing user/chat ids" };
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
