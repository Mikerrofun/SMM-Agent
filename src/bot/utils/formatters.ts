import { RunStatus } from "../../db/generated/client";

/**
 * Метки статусов запуска пайплайна для UI
 */
export const STATUS_LABELS: Record<RunStatus, string> = {
  [RunStatus.RUNNING]: "⏳ Выполняется",
  [RunStatus.SUCCESS]: "✅ Успешно",
  [RunStatus.FAILED]: "❌ Ошибка",
};

/**
 * Форматирует дату в московское время
 * @param date - Дата для форматирования
 * @returns Строка с датой в московском формате
 */
export function formatMoscowTime(date: Date): string {
  return date.toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });
}
