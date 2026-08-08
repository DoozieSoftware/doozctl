/**
 * Command Dispatcher: routes command names to application service handlers.
 *
 * Deliberately decoupled from any CLI framework. A handler is just a function
 * from arguments to a process exit code.
 */

/** Exit codes shared across command handlers. */
export enum ExitCode {
  OK = 0,
  Error = 1,
}

/** A handler for a single command. */
export type CommandHandler = (args: string[]) => Promise<number>;

/** Routes command names to handlers. */
export class Dispatcher {
  private handlers = new Map<string, CommandHandler>();

  /** Register a handler under a command name. */
  register(name: string, h: CommandHandler): this {
    this.handlers.set(name, h);
    return this;
  }

  /** Dispatch a command to its handler. */
  async dispatch(name: string, args: string[]): Promise<number> {
    const h = this.handlers.get(name);
    if (!h) {
      throw new Error(`unknown command: ${name}`);
    }
    return h(args);
  }

  /** Registered command names, sorted. */
  commands(): string[] {
    return [...this.handlers.keys()].sort();
  }
}
