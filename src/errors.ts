import { ExitCode } from "./dispatcher/dispatcher.js";

/**
 * Command-line usage error: the command was invoked with invalid arguments.
 * Maps to exit code 2, distinct from runtime failures (exit code 1).
 */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }

  /** The process exit code the CLI should return for this error. */
  get exitCode(): number {
    return ExitCode.Usage;
  }
}
