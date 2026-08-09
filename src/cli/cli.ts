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
export const VERSION = "0.3.0-alpha.1";

/** Internal signal carrying a non-zero exit code out of a commander action. */
export class ExitCodeError extends Error {
  constructor(readonly exitCode: number) {
    super(`command exited with code ${exitCode}`);
    this.name = "ExitCodeError";
  }
}

/** Per-command help surfaced in the CLI. */
interface CommandHelp {
  description: string;
  argumentDescription: string;
  usage: string;
  example: string;
}

/** Help text for the built-in commands, keyed by command name. */
const COMMAND_HELP: Readonly<Record<string, CommandHelp>> = {
  init: {
    description: "Initialize a repository with AI repository standards.",
    argumentDescription: "the repository path, then the Standards Package directory",
    usage: "doozctl init <repo> <package>",
    example: "doozctl init . ./standards",
  },
  analyze: {
    description: "Update the repository analysis. Read-only.",
    argumentDescription: "the repository path",
    usage: "doozctl analyze [repo]",
    example: "doozctl analyze .",
  },
  sync: {
    description: "Re-render managed artifacts, preserving developer content.",
    argumentDescription: "the repository path, then the Standards Package directory",
    usage: "doozctl sync <repo> <package>",
    example: "doozctl sync . ./standards",
  },
  doctor: {
    description: "Validate the repository and report problems. Read-only.",
    argumentDescription: "the repository path",
    usage: "doozctl doctor [repo]",
    example: "doozctl doctor .",
  },
  summarize: {
    description: "Append an immutable session summary and update the current context.",
    argumentDescription: "the repository path, the Standards Package directory, and a session file",
    usage:
      "doozctl summarize <repo> <package> <session-file> [--tool <tool>] [--model <model>] [--user <user>]",
    example: "doozctl summarize . ./standards .ai/pending.md --tool claude --model opus",
  },
  status: {
    description: "Display repository status. Read-only.",
    argumentDescription: "the repository path",
    usage: "doozctl status [repo]",
    example: "doozctl status .",
  },
};

/**
 * Rewrite engine errors into user-facing guidance at the CLI boundary. The
 * engine keeps its precise messages; the CLI owns how they read to a human.
 */
export function humanizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  if (message.startsWith("standards package not found:")) {
    const at = message.slice("standards package not found:".length).trim();
    return [
      `Standards package not found at ${at}.`,
      "Pass a directory that contains a standards package (a package.json manifest).",
    ].join("\n");
  }

  if (message.includes("no managed block markers")) {
    return [
      "A destination file already exists but is not engine-managed, so it was left untouched.",
      "Convert that file to a managed-blocks artifact (or remove it), then run init or sync again.",
    ].join("\n");
  }

  if (message.includes("refusing replace-generated overwrite")) {
    return [
      "A destination file already exists and is not engine-generated, so it was left untouched.",
      "replace-generated only rewrites files that carry the engine-generated marker. Convert or remove the file, then run sync again.",
    ].join("\n");
  }

  if (message.startsWith("session file not found:")) {
    const at = message.slice("session file not found:".length).trim();
    return [
      `Session file not found at ${at}.`,
      "Pass the path to a file containing the AI-authored session summary.",
    ].join("\n");
  }

  return message;
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
    const command = program.command(name);
    const help = COMMAND_HELP[name];
    if (help !== undefined) {
      command
        .description(help.description)
        .argument("[args...]", help.argumentDescription)
        .allowUnknownOption(true)
        .addHelpText("after", `\nUsage: ${help.usage}\n\nExample: ${help.example}\n`);
    } else {
      command.argument("[args...]").allowUnknownOption(true);
    }
    command.allowExcessArguments(true).action(async (args: string[]) => {
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
    stderr.write(`doozctl: ${humanizeError(err)}\n`);
    return ExitCode.Error;
  }
}
