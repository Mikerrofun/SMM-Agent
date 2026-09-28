/**
 * Бросается из checkCancelled(), когда команда была отменена
 * (кнопка «Отменить» или таймаут пайплайна).
 *
 * reason — человекочитаемая причина отмены (например, текст таймаута);
 * для отмены пользователем reason не задан.
 */
export class CommandCancelledError extends Error {
  readonly reason?: string;

  constructor(reason?: string) {
    super(reason ?? 'Command cancelled');
    this.name = 'CommandCancelledError';
    this.reason = reason;
  }
}
