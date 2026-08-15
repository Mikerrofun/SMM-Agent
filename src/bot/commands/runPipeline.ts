import type { Context } from "grammy";
import { runFullPipeline } from "../../services/pipeline/pipelineService";

let isPipelineRunning = false;
const PIPELINE_TIMEOUT_MS = 30 * 60 * 1000;

export async function handleRunPipelineCommand(ctx: Context): Promise<void> {
  let statusMessage: { chat: { id: number }, message_id: number } | null = null;

  try {
    if (isPipelineRunning) {
      await ctx.reply(
        "⚠️ Пайплайн уже выполняется. Дождитесь завершения текущего прогона."
      );
      return;
    }

    isPipelineRunning = true;

    statusMessage = await ctx.reply(
      "🚀 Запуск пайплайна генерации идей...\n\n" +
      "⏳ Инициализация..."
    );

    const startTime = Date.now();

    const pipelinePromise = runFullPipeline(async (stage, status) => {
      try {
        if (statusMessage) {
          await ctx.api.editMessageText(
            statusMessage.chat.id,
            statusMessage.message_id,
            `🚀 Пайплайн генерации идей\n\n${status}`
          );
        }
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

    let finalMessage = "✅ <b>Пайплайн успешно завершен!</b>\n\n";
    finalMessage += "📊 <b>Статистика:</b>\n";
    finalMessage += "━━━━━━━━━━━━━━━━━━━━━━\n\n";

    finalMessage += `📡 <b>Парсинг каналов:</b>\n`;
    finalMessage += `   • Обработано каналов: ${result.parsing.totalChannels}\n`;
    finalMessage += `   • Успешно: ${result.parsing.successfulChannels}\n`;
    finalMessage += `   • Новых постов: ${result.parsing.savedPosts}\n`;
    if (result.parsing.skippedPosts > 0) {
      finalMessage += `   • Пропущено (дубли): ${result.parsing.skippedPosts}\n`;
    }
    finalMessage += "\n";

    finalMessage += `💡 <b>Генерация идей:</b>\n`;
    finalMessage += `   • Обработано постов: ${result.ideas.total}\n`;
    finalMessage += `   • Создано идей: ${result.ideas.succeeded}\n`;
    if (result.ideas.failed > 0) {
      finalMessage += `   • Ошибок: ${result.ideas.failed}\n`;
    }
    finalMessage += "\n";

    finalMessage += `🔍 <b>Дедупликация:</b>\n`;
    finalMessage += `   • Проверено идей: ${result.deduplication.total}\n`;
    finalMessage += `   • Уникальных: ${result.deduplication.unique}\n`;
    if (result.deduplication.duplicates > 0) {
      finalMessage += `   • Дубликатов: ${result.deduplication.duplicates}\n`;
    }
    finalMessage += "\n";

    finalMessage += "━━━━━━━━━━━━━━━━━━━━━━\n";
    finalMessage += `⏱ Время выполнения: ${formatDuration(duration)}\n\n`;

    if (result.deduplication.unique > 0) {
      finalMessage += `✨ Готово ${result.deduplication.unique} ${pluralizeNewIdea(result.deduplication.unique)}!\n`;
      finalMessage += "Используйте /ideas для просмотра.";
    } else {
      finalMessage += "💡 Новых уникальных идей не найдено.";
    }

    if (statusMessage) {
      await ctx.api.editMessageText(
        statusMessage.chat.id,
        statusMessage.message_id,
        finalMessage,
        { parse_mode: "HTML" }
      );
    }

  } catch (error) {
    console.error("Error in /run_pipeline command:", error);
    
    const errorMessage = error instanceof Error ? error.message : "Неизвестная ошибка";
    
    try {
      const shortError = errorMessage.length > 200 
        ? errorMessage.substring(0, 200) + "..." 
        : errorMessage;

      const errorMsg = 
        "❌ <b>Ошибка выполнения пайплайна</b>\n\n" +
        shortError + "\n\n" +
        "Проверьте логи для подробностей.";

      if (statusMessage) {
        await ctx.api.editMessageText(
          statusMessage.chat.id,
          statusMessage.message_id,
          errorMsg
        );
      } else {
        await ctx.reply(errorMsg);
      }
    } catch (replyError) {
      console.error("Failed to send error message:", replyError);
      
      try {
        const fallbackMsg = "❌ Ошибка выполнения пайплайна. Проверьте логи.";
        if (statusMessage) {
          await ctx.api.editMessageText(
            statusMessage.chat.id,
            statusMessage.message_id,
            fallbackMsg
          );
        } else {
          await ctx.reply(fallbackMsg);
        }
      } catch (fallbackError) {
        console.error("Failed to send fallback message:", fallbackError);
      }
    }
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

function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds} сек`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (remainingSeconds === 0) {
    return `${minutes} мин`;
  }

  return `${minutes} мин ${remainingSeconds} сек`;
}

function pluralizeNewIdea(count: number): string {
  const lastDigit = count % 10;
  const lastTwoDigits = count % 100;

  if (lastTwoDigits >= 11 && lastTwoDigits <= 19) {
    return "новых идей";
  }

  if (lastDigit === 1) {
    return "новая идея";
  }

  if (lastDigit >= 2 && lastDigit <= 4) {
    return "новые идеи";
  }

  return "новых идей";
}
