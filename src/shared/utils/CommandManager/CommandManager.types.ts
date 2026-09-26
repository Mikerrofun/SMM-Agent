import type { Context } from 'grammy';

/**
 * Состояние зарегистрированной команды.
 * Запись остаётся в activeCommands до завершения execute (cleanup в finally),
 * иначе checkCancelled не увидит отмену после abort().
 */
export interface CommandState {
  controller: AbortController;
  userId: number;
  commandName: string;
  startedAt: Date;
  chatId: number;
}

/**
 * Допустимые имена команд для CommandManager.
 * Используются в commandId (`${userId}_${commandName}`) и в сообщении «уже выполняется».
 */
export const COMMAND_NAMES = [
  'run_pipeline',
  'natalia_channel_post',
  'transcript_post_pdf',
  'generate_post',
  'regenerate_post',
] as const;

export type CommandName = (typeof COMMAND_NAMES)[number];

/**
 * Опции execute.
 *
 * statusText — текст стартового статус-сообщения (отправляется с кнопкой отмены).
 * successText — если задан, статус-сообщение редактируется в этот текст при успехе.
 *   Команды, которые сами удаляют статус-сообщение (transcript/natalia), опцию не задают.
 * singleton — глобальная блокировка по commandName независимо от userId
 *   (нужна для пайплайна: только один прогон одновременно, включая крон).
 */
export type ExecuteOptions = {
  statusText: string;
  successText?: string;
  singleton?: boolean;
};

/**
 * Представление отправленного статус-сообщения (достаточно для editMessageText).
 */
export type CommandStatusMessage = {
  chat: { id: number };
  message_id: number;
};

/**
 * Аргументы, передаваемые хендлеру команды помимо ctx.
 */
export type CommandHandlerContext = {
  statusMessage: CommandStatusMessage;
};

export type CommandHandler<T> = (
  ctx: Context,
  context: CommandHandlerContext
) => Promise<T>;

/**
 * Результат execute:
 * - completed — хендлер завершился успешно, value — его результат;
 * - cancelled — команда была отменена через кнопку/таймаут;
 * - already_running — запуск заблокирован (эта же команда у пользователя или singleton).
 *
 * execute возвращает null, если запуск невозможен (в ctx нет from/chat — например,
 * синтетический контекст без идентификаторов) или при неожиданной ошибке в execute.
 */
export type CommandExecuteResult<T> =
  | { status: 'completed'; value: T }
  | { status: 'cancelled' }
  | { status: 'already_running' };
