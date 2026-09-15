/**
 * Константы и типы для команды запуска пайплайна генерации идей
 */

/**
 * Флаг выполнения пайплайна (защита от параллельных запусков)
 */
export let isPipelineRunning = false;

/**
 * Устанавливает флаг выполнения пайплайна
 */
export function setIsPipelineRunning(value: boolean): void {
  isPipelineRunning = value;
}

/**
 * Максимальное время выполнения пайплайна (30 минут)
 */
export const PIPELINE_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Telegram ограничивает частоту editMessageText (~1 раз в 2-3 секунды на сообщение),
 * иначе ловим 429 Too Many Requests.
 * 
 * Этот интервал используется для троттлинга обновлений статуса во время выполнения пайплайна.
 */
export const STATUS_EDIT_INTERVAL_MS = 3000;

/**
 * Настройки retry для редактирования сообщений в Telegram
 * - maxAttempts: 4 попытки
 * - delayMs: 3 секунды начальная задержка
 * - backoffFactor: 1.5x увеличение задержки с каждой попыткой
 */
export const TELEGRAM_EDIT_RETRY = {
  maxAttempts: 4,
  delayMs: 3000,
  backoffFactor: 1.5,
} as const;

/**
 * Тип для представления отправленного сообщения в Telegram
 */
export type StatusMessage = {
  chat: { id: number };
  message_id: number;
};
