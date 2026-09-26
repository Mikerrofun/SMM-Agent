import type { Context } from "grammy";
import { GenerationRun, RunStatus } from "../../db/generated/client";
import { getLatestRun } from "../../repositories/generationRunRepository";
import { formatDuration } from "../../shared/utils/pipelineReportFormatter";
import {
  broadcastToSubscribers,
  getSubscriberChatIds,
} from "../../shared/telegram/subscribers";
import { STATUS_LABELS, formatMoscowTime } from "../utils/formatters";

/**
 * Форматирует отчёт по записи GenerationRun из БД.
 */
export function formatLastRunReport(run: GenerationRun): string {
  let message = "📊 <b>Последний запуск пайплайна</b>\n\n";

  if (run.status === RunStatus.CANCELLED) {
    message += "🚫 Последний прогон был отменён.\n\n";
  }

  message += `Статус: ${STATUS_LABELS[run.status]}\n`;
  message += `🕐 Начало: ${formatMoscowTime(run.startedAt)} (МСК)\n`;

  if (run.finishedAt) {
    message += `🏁 Завершение: ${formatMoscowTime(run.finishedAt)} (МСК)\n`;
    const durationSeconds = Math.max(
      0,
      Math.round((run.finishedAt.getTime() - run.startedAt.getTime()) / 1000)
    );
    message += `⏱ Длительность: ${formatDuration(durationSeconds)}\n\n`;
  } else {
    const elapsedSeconds = Math.max(
      0,
      Math.round((new Date().getTime() - run.startedAt.getTime()) / 1000)
    );
    message += `⏱ Прошло времени: ${formatDuration(elapsedSeconds)}\n\n`;
  }

  message += "📈 <b>Статистика:</b>\n";
  message += `   • Обработано постов: ${run.processedPosts}\n`;
  message += `   • Создано идей: ${run.generatedIdeas}\n`;
  message += `   • Принято идей: ${run.acceptedIdeas}\n`;
  message += `   • Отклонено идей: ${run.rejectedIdeas}\n`;
  message += `   • OpenAI запросов: ${run.openaiRequests}\n`;

  return message;
}

export async function handleLastRunCommand(ctx: Context): Promise<void> {
  try {
    const run = await getLatestRun();

    if (!run) {
      await ctx.reply(
        "📭 Запусков пайплайна ещё не было. Запустите /run_pipeline."
      );
      return;
    }

    const report = formatLastRunReport(run);
    const subscribers = getSubscriberChatIds();
    const requesterChatId = ctx.chat?.id?.toString();

    // Инициатор всегда получает отчёт напрямую в чат, откуда вызвал команду
    await ctx.reply(report, { parse_mode: "HTML" });

    // Остальным подписчикам — рассылкой (инициатор исключён, чтобы не было дубля)
    const targets = subscribers.filter((id) => id !== requesterChatId);
    if (targets.length > 0) {
      const { sent, failed } = await broadcastToSubscribers(
        ctx.api,
        report,
        { parse_mode: "HTML" },
        targets
      );
      console.log(
        `[last_run] Отчёт отправлен: ${sent} успешно, ${failed} с ошибкой`
      );
    }
  } catch (error) {
    console.error("Error in /last_run command:", error);
    await ctx.reply(
      "❌ Не удалось получить отчёт о последнем запуске. Проверьте логи."
    );
  }
}
