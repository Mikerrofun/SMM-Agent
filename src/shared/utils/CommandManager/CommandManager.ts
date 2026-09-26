/**
 * Менеджер долгоживущих команд бота.
 *
 * execute:
 * 1. проверяет, не запущена ли уже команда (per-user по `${userId}_${commandName}`,
 *    при singleton — глобально по commandName);
 * 2. регистрирует AbortController в activeCommands;
 * 3. отправляет стартовое статус-сообщение с инлайн-кнопкой «Отменить»;
 * 4. запускает хендлер внутри AsyncLocalStorage с commandId.
 *
 * Отмена: пользователь жмёт кнопку → cancel(commandId) → abort(). Внутри команды
 * и сервисов checkCancelled() бросает CommandCancelledError, execute ловит его,
 * редактирует статус-сообщение в «Команда отменена» и снимает команду с учёта.
 *
 * Вне бота (npm-скрипты) AsyncLocalStorage пуст → checkCancelled() — no-op,
 * поэтому сервисы могут вызывать его всегда.
 */

import { Context } from 'grammy';
import { AsyncLocalStorage } from 'async_hooks';
import { CommandCancelledError } from './CommandManager.errors';
import { buildCancelKeyboard, buildCommandId } from './cancelButton';
import type {
  CommandExecuteResult,
  CommandHandler,
  CommandName,
  CommandState,
  CommandStatusMessage,
  ExecuteOptions,
} from './CommandManager.types';

class CommandManager {
  private static instance: CommandManager;
  private activeCommands = new Map<string, CommandState>();
  private commandContext = new AsyncLocalStorage<string>();

  private constructor() {
    // unref: таймер очистки не должен держать процесс (и тест-раннер) живым
    setInterval(() => this.cleanupStaleCommands(), 30 * 60 * 1000).unref();
  }

  static getInstance(): CommandManager {
    if (!CommandManager.instance) {
      CommandManager.instance = new CommandManager();
    }
    return CommandManager.instance;
  }

  private makeId(userId: number, commandName: string): string {
    return buildCommandId(userId, commandName);
  }

  isRunning(userId: number, commandName: CommandName): boolean {
    const commandId = this.makeId(userId, commandName);
    return this.activeCommands.has(commandId);
  }

  isCommandRunning(commandId: string): boolean {
    return this.activeCommands.has(commandId);
  }

  async execute<T>(
    ctx: Context,
    commandName: CommandName,
    options: ExecuteOptions,
    handler: CommandHandler<T>
  ): Promise<CommandExecuteResult<T> | null> {
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;

    if (!userId || !chatId) {
      console.error('[CommandManager] Missing userId or chatId');
      return null;
    }

    const commandId = this.makeId(userId, commandName);

    // Проверка: уже запущена? (per-user, а с singleton — глобально по имени)
    if (
      this.isRunning(userId, commandName) ||
      (options.singleton && this.isCommandNameRunning(commandName))
    ) {
      await ctx.reply('⏳ Эта команда уже выполняется. Дождись завершения или отмени её.');
      return { status: 'already_running' };
    }

    const controller = new AbortController();
    this.activeCommands.set(commandId, {
      controller,
      userId,
      commandName,
      startedAt: new Date(),
      chatId,
    });

    let statusMessage: CommandStatusMessage | undefined;

    try {
      statusMessage = (await ctx.reply(options.statusText, {
        reply_markup: buildCancelKeyboard(commandId),
      })) as unknown as CommandStatusMessage;

      // Запускаем в контексте AsyncLocalStorage
      const result = await this.commandContext.run(commandId, () =>
        handler(ctx, { statusMessage: statusMessage! })
      );

      if (options.successText && statusMessage) {
        try {
          await ctx.api.editMessageText(
            chatId,
            statusMessage.message_id,
            options.successText
          );
        } catch (editError) {
          console.error(`[${commandName}] Failed to edit success message:`, editError);
        }
      }

      return { status: 'completed', value: result };
    } catch (error) {
      if (error instanceof CommandCancelledError) {
        console.log(`[${commandName}] Cancelled by user ${userId}`);

        if (statusMessage) {
          try {
            await ctx.api.editMessageText(
              chatId,
              statusMessage.message_id,
              error.reason
                ? `❌ Команда отменена: ${error.reason}`
                : '❌ Команда отменена'
            );
          } catch (editError) {
            console.error(`[${commandName}] Failed to edit cancel message:`, editError);
          }
        }

        return { status: 'cancelled' };
      }

      console.error(`[${commandName}] Error for user ${userId}:`, error);

      try {
        await ctx.reply(
          `❌ Ошибка: ${error instanceof Error ? error.message : String(error)}`
        );
      } catch (replyError) {
        console.error(`[${commandName}] Failed to send error message:`, replyError);
      }

      return null;
    } finally {
      this.activeCommands.delete(commandId);
    }
  }

  checkCancelled(): void {
    const commandId = this.commandContext.getStore();
    if (!commandId) return;

    const state = this.activeCommands.get(commandId);
    if (state?.controller.signal.aborted) {
      throw new CommandCancelledError(
        typeof state.controller.signal.reason === 'string'
          ? state.controller.signal.reason
          : undefined
      );
    }
  }

  // === ОТМЕНА КОМАНДЫ (из callback) ===
  // Запись не удаляется сразу: checkCancelled должен увидеть abort
  // до завершения execute (cleanup в finally)
  cancel(commandId: string): boolean {
    const state = this.activeCommands.get(commandId);
    if (state && !state.controller.signal.aborted) {
      console.log(`[CommandManager] Cancelling command: ${commandId}`);
      state.controller.abort();
      return true;
    }
    return false;
  }

  // === ОТМЕНА ТЕКУЩЕЙ КОМАНДЫ (изнутри, например таймаут пайплайна) ===
  cancelCurrent(reason?: string): boolean {
    const commandId = this.commandContext.getStore();
    if (!commandId) return false;

    const state = this.activeCommands.get(commandId);
    if (state && !state.controller.signal.aborted) {
      state.controller.abort(reason);
      return true;
    }
    return false;
  }

  /**
   * Отменена ли текущая команда (без бросания исключения).
   * Используется в fire-and-forget колбэках прогресса, чтобы отложенный
   * edit не перезаписал сообщение «Команда отменена».
   */
  isCurrentCancelled(): boolean {
    const commandId = this.commandContext.getStore();
    if (!commandId) return false;

    const state = this.activeCommands.get(commandId);
    return state ? state.controller.signal.aborted : false;
  }

  // === ОЧИСТКА ЗАВИСШИХ КОМАНД (> 1 часа) ===
  private cleanupStaleCommands(): void {
    const now = Date.now();
    const STALE_THRESHOLD = 60 * 60 * 1000; // 1 час

    for (const [commandId, state] of this.activeCommands.entries()) {
      const age = now - state.startedAt.getTime();
      if (age > STALE_THRESHOLD) {
        console.warn(`[CommandManager] Cleaning up stale command: ${commandId} (age: ${Math.round(age / 60000)}min)`);
        this.activeCommands.delete(commandId);
      }
    }
  }

  private isCommandNameRunning(commandName: CommandName): boolean {
    for (const [commandId] of this.activeCommands.entries()) {
      if (commandId.endsWith(`_${commandName}`)) {
        return true;
      }
    }
    return false;
  }

  getActiveCommands(): CommandState[] {
    return Array.from(this.activeCommands.values());
  }

  getCommandCount(): number {
    return this.activeCommands.size;
  }
}

export const commandManager = CommandManager.getInstance();

export function checkCancelled(): void {
  commandManager.checkCancelled();
}
