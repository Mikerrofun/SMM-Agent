import { Context } from 'grammy';
import { AsyncLocalStorage } from 'async_hooks';
import { CommandState } from './CommandManager.types'

const commandContext = new AsyncLocalStorage<string>();


class CommandManager {
  private static instance: CommandManager;
  private activeCommands = new Map<string, CommandState>();

  private constructor() {
    setInterval(() => this.cleanupStaleCommands(), 30 * 60 * 1000);
  }

  static getInstance(): CommandManager {
    if (!CommandManager.instance) {
      CommandManager.instance = new CommandManager();
    }
    return CommandManager.instance;
  }

  private makeId(userId: number, commandName: string): string {
    return `${userId}_${commandName}`;
  }

  isRunning(userId: number, commandName: string): boolean {
    const commandId = this.makeId(userId, commandName);
    return this.activeCommands.has(commandId);
  }

  async execute<T>(
    ctx: Context,
    commandName: string,
    options: {
      statusText: string;
      successText?: string;
    },
    handler: (ctx: Context) => Promise<T>
  ): Promise<T | null> {
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;

    if (!userId || !chatId) {
      console.error('[CommandManager] Missing userId or chatId');
      return null;
    }

    const commandId = this.makeId(userId, commandName);

    // Проверка: уже запущена?
    if (this.isRunning(userId, commandName)) {
      await ctx.reply('⏳ Эта команда уже выполняется. Дождись завершения или отмени её.');
      return null;
    }

    const controller = new AbortController();
    this.activeCommands.set(commandId, {
      controller,
      userId,
      commandName,
      startedAt: new Date(),
      chatId,
    });

    let statusMessageId: number | undefined;

    try {
      const statusMessage = await ctx.reply(options.statusText, {
        reply_markup: {
          inline_keyboard: [[
            { text: '❌ Отменить', callback_data: `cancel:${commandId}` }
          ]]
        }
      });
      statusMessageId = statusMessage.message_id;

      // Запускаем в контексте AsyncLocalStorage
      const result = await commandContext.run(commandId, () => handler(ctx));

      if (options.successText && statusMessageId) {
        try {
          await ctx.api.editMessageText(
            chatId,
            statusMessageId,
            options.successText
          );
        } catch (editError) {
          console.error(`[${commandName}] Failed to edit success message:`, editError);
        }
      }

      return result;

    } catch (error: any) {
      if (error.message === 'Command cancelled') {
        console.log(`[${commandName}] Cancelled by user ${userId}`);

        if (statusMessageId) {
          try {
            await ctx.api.editMessageText(
              chatId,
              statusMessageId,
              '❌ Команда отменена'
            );
          } catch (editError) {
            console.error(`[${commandName}] Failed to edit cancel message:`, editError);
          }
        }
      } else {
        console.error(`[${commandName}] Error for user ${userId}:`, error);

        try {
          await ctx.reply(`❌ Ошибка: ${error.message}`);
        } catch (replyError) {
          console.error(`[${commandName}] Failed to send error message:`, replyError);
        }
      }

      return null;
    } finally {
      this.activeCommands.delete(commandId);
    }
  }

  checkCancelled(): void {
    const commandId = commandContext.getStore();
    if (!commandId) return; 

    const state = this.activeCommands.get(commandId);
    if (state?.controller.signal.aborted) {
      throw new Error('Command cancelled');
    }
  }

  // === ОТМЕНА КОМАНДЫ (из callback) ===
  cancel(commandId: string): boolean {
    const state = this.activeCommands.get(commandId);
    if (state) {
      console.log(`[CommandManager] Cancelling command: ${commandId}`);
      state.controller.abort();
      return true;
    }
    return false;
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
