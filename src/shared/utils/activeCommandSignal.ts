  import type { Context } from 'grammy';
  
  
  export class ActiveCommand {
    public activeCommands = new Map<string, AbortController>();

    constructor() {}

   public initCommand(ctx: Context): string {
        const commandId = `${ctx.chat!.id}_${Date.now()}`;
        const abortController = new AbortController();
        
        this.activeCommands.set(commandId, abortController);
        
        return commandId;
    }


    public isAborted(commandId: string): boolean {
        const controller = this.activeCommands.get(commandId);
        return controller ? controller.signal.aborted : false;
    }

     public getSignal(commandId: string): AbortSignal | undefined {
        return this.activeCommands.get(commandId)?.signal;
    }

    public cancel(commandId: string, reason?: string): void {
        const controller = this.activeCommands.get(commandId);
        if (controller) {
            controller.abort(reason);
            this.activeCommands.delete(commandId);
        }
    }

}
