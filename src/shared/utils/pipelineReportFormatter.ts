import type { PipelineResult } from '../../services/pipeline/pipelineService.types';

/**
 * Форматирует детальный отчёт о выполнении пайплайна
 * @param result - Результат выполнения пайплайна
 * @param duration - Длительность выполнения в секундах
 * @returns HTML-форматированное сообщение для Telegram
 */
export function formatPipelineReport(result: PipelineResult, duration: number): string {
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
  finalMessage += `   • Проверено всего идей: ${result.deduplication.total}\n`;
  finalMessage += `   • Новых из прогона: ${result.ideas.succeeded}\n`;
  finalMessage += `   • Уникальных из прогона: ${result.acceptedIdeasFromRun}\n`;
  if (result.deduplication.duplicates > 0) {
    finalMessage += `   • Дубликатов найдено: ${result.deduplication.duplicates}\n`;
  }
  finalMessage += "\n";

  finalMessage += "━━━━━━━━━━━━━━━━━━━━━━\n";
  finalMessage += `⏱ Время выполнения: ${formatDuration(duration)}\n\n`;

  if (result.acceptedIdeasFromRun > 0) {
    finalMessage += `✨ Готово ${result.acceptedIdeasFromRun} ${pluralizeNewIdea(result.acceptedIdeasFromRun)}!\n`;
    finalMessage += "Используйте /ideas для просмотра.";
  } else {
    finalMessage += "💡 Новых уникальных идей не найдено.";
  }

  return finalMessage;
}

/**
 * Форматирует длительность выполнения в читаемый вид
 * @param seconds - Количество секунд
 * @returns Строка вида "2 мин 30 сек" или "45 сек"
 */
export function formatDuration(seconds: number): string {
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

/**
 * Склоняет слово "идея" в зависимости от числа
 * @param count - Количество идей
 * @returns "новая идея", "новые идеи" или "новых идей"
 */
export function pluralizeNewIdea(count: number): string {
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
