import { Command, CommanderError } from "commander";
import { Dispatcher, ExitCode } from "../dispatcher/dispatcher.js";

/**
 * CLI: the thin command-line interface.
 *
 * It uses commander only for argument parsing and help. Every command routes
 * through the Command Dispatcher to application services; no business logic
 * lives in this layer. The program never calls process.exit so it is safe to
 * invoke in tests.
 */

/** Program metadata, overridable at build time. */
export const VERSION = "0.1.0-alpha.1";

/** Internal signal carrying a non-zero exit code out of a commander action. */
export class ExitCodeError extends Error {
  constructor(readonly exitCode: number) {
    super(`command exited with code ${exitCode}`);
    this.name = "ExitCodeError";
  }
}

/** Build the commander program, wiring each command to the dispatcher. */
export function buildProgram(
  dispatcher: Dispatcher,
  stdout: NodeJS.WritableStream = process.stdout,
  stderr: NodeJS.WritableStream = process.stderr,
): Command {
  const program = new Command();
  program
    .name("doozctl")
    .description("Install and maintain AI repository standards.")
    .version(VERSION)
    .exitOverride()
    .configureOutput({ writeOut: (s) => stdout.write(s), writeErr: (s) => stderr.write(s) });

  for (const name of dispatcher.commands()) {
    program
      .command(name)
      .argument("[args...]")
      .allowExcessArguments(true)
      .action(async (args: string[]) => {
        const code = await dispatcher.dispatch(name, args);
        if (code !== ExitCode.OK) {
          throw new ExitCodeError(code);
        }
      });
  }

  return program;
}

/**
 * Run the CLI with the given argv (excluding the executable name) and return
 * the exit code. Never calls process.exit; safe for use in tests.
 */
export async function runCli(
  argv: string[],
  dispatcher: Dispatcher,
  opts: { stdout?: NodeJS.WritableStream; stderr?: NodeJS.WritableStream } = {},
): Promise<number> {
  const stdout = opts.stdout ?? process.stdout;
  const stderr = opts.stderr ?? process.stderr;
  const program = buildProgram(dispatcher, stdout, stderr);

  try {
    if (argv.length === 0) {
      program.help();
      return ExitCode.OK;
    }
    await program.parseAsync(argv, { from: "user" });
    return ExitCode.OK;
  } catch (err) {
    if (err instanceof ExitCodeError) {
      return err.exitCode;
    }
    if (err instanceof CommanderError) {
      // help/version display and unknown-command errors carry their own code.
      return err.exitCode ?? ExitCode.Error;
    }
    stderr.write(`doozctl: ${err instanceof Error ? err.message : String(err)}\n`);
    return ExitCode.Error;
  }
}
