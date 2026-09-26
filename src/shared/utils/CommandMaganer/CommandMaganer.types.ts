export interface CommandState {
  controller: AbortController;
  userId: number;
  commandName: string;
  startedAt: Date;
  chatId: number;
}