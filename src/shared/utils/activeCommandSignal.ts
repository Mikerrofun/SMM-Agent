  import type { Context } from 'grammy';
  
  
  const activeCommands = new Map<string, AbortController>();
  
  
  const controller = new AbortController();
  const signal = controller.signal;

  


  export class ActiveCommand {
    private abortController: AbortController;
    public activeCommands = new Map<string, AbortController>();

    constructor() {
        this.abortController = new AbortController();
    }

    public initCommand(ctx: Context): void {
        const commandId = `${ctx.chat!.id}_${Date.now()}`;
        this.activeCommands.set(commandId , this.abortController);
    }


    public get aborted(): boolean {
        return this.abortController.signal.aborted;
    }

   public cancel(reason?: string): void {
        this.abortController.abort(reason);
    }

    public getSignal(): AbortSignal {
        return this.abortController.signal;
    }

}
