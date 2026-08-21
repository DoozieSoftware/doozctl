import { Command, CommanderError } from "commander";
import { Dispatcher, ExitCode } from "../dispatcher/dispatcher.js";
import { UsageError } from "../errors.js";

/**
 * CLI: the thin command-line interface.
 *
 * It uses commander only for argument parsing and help. Every command routes
 * through the Command Dispatcher to application services; no business logic
 * lives in this layer. The program never calls process.exit so it is safe to
 * invoke in tests.
 */

/** Program metadata, set from package.json at build time. */
export const VERSION = process.env.npm_package_version ?? "0.0.0-dev";

/** Internal signal carrying a non-zero exit code out of a commander action. */
export class ExitCodeError extends Error {
  constructor(readonly exitCode: number) {
    super(`command exited with code ${exitCode}`);
    this.name = "ExitCodeError";
  }
}

/** Per-command help surfaced in the CLI. */
export interface CommandHelp {
  description: string;
  argumentDescription: string;
  usage: string;
  example: string;
  /** Optional full help block replacing the generic Usage/Example footer. */
  helpText?: string;
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
    description:
      "Re-analyze the repository and update the repository memory (.ai/repository-analysis.json).",
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
    argumentDescription: "the repository path, then the Standards Package directory",
    usage: "doozctl doctor <repo> <package>",
    example: "doozctl doctor . ./standards",
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
 * Help for the plan command. Methods are adopted per repository, so the help
 * explains where they come from rather than listing them; the default method
 * comes from the frozen contract (WORKFLOW-SPEC.md).
 */
export function planCommandHelp(defaultMethod: string): CommandHelp {
  return {
    description:
      "Create a repository-local engineering Plan (intent, context, workflow method, evidence) under .dooz/plans/.",
    argumentDescription: "the repository path (default .), then --method and --title flags",
    usage: "doozctl plan [repo] [--method <method>] [--title <title>]",
    example: "doozctl plan --method bug-fix",
    helpText: [
      "",
      "A Plan is the durable unit of engineering work: what you are trying to",
      "accomplish, why, what is in and out of scope, and how you will know it is",
      "done. Plans are created at PLANNED under .dooz/plans/active/ as",
      "YYYY-MM-DD-<id>.md and are never overwritten.",
      "",
      "The method selects a workflow the repository has adopted:",
      ".dooz/workflows/adopted/<id>.md (from a Standards Package) or a project-",
      "specific .dooz/workflows/project/<id>.md. Without --method, the default",
      `method (${defaultMethod}) is used.`,
      "",
      "Usage: doozctl plan [repo] [--method <method>] [--title <title>]",
      "",
      "Examples:",
      "  doozctl plan",
      "  doozctl plan --method bug-fix",
      '  doozctl plan --method feature --title "attendance punch sync"',
    ].join("\n"),
  };
}

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

  if (message.includes("destination already exists and is not engine-generated")) {
    return [
      "A destination file already exists and is not engine-owned, so it was left untouched.",
      "overwrite only rewrites files DoozCTL created. Remove or convert the file, then run the command again.",
    ].join("\n");
  }

  if (message.startsWith("session file not found:")) {
    const at = message.slice("session file not found:".length).trim();
    return [
      `Session file not found at ${at}.`,
      "Pass the path to a file containing the AI-authored session summary.",
    ].join("\n");
  }

  if (message.startsWith("plan already exists:")) {
    const id = message.slice("plan already exists:".length).trim();
    return [
      `Plan already exists: ${id} — left untouched. DoozCTL never overwrites a plan.`,
      "Pass --title with a distinct name to create a separate plan.",
    ].join("\n");
  }

  if (message.startsWith("duplicate workflow method:")) {
    const id = message.slice("duplicate workflow method:".length).trim();
    return [
      `Duplicate workflow method: ${id} — defined in both .dooz/workflows/adopted/ and .dooz/workflows/project/.`,
      "Adopt a method id in exactly one place. Remove one of the documents, then run the command again.",
    ].join("\n");
  }

  if (message.startsWith("workflow method asset is malformed:")) {
    const id = message.slice("workflow method asset is malformed:".length).trim();
    return [
      `Workflow method document is malformed: ${id}.`,
      "Every workflow document must declare `- id: <method-id>` inside its `## Metadata` section.",
    ].join("\n");
  }

  if (message.startsWith("invalid evidence requirement:")) {
    return [
      `${message}.`,
      "Valid evidence categories are: acceptance-criteria, commit, git-state, release, tests, verification.",
      "Fix the `## Required Evidence` checklist in the workflow document, then run the command again.",
    ].join("\n");
  }

  return message;
}

/** Build the commander program, wiring each command to the dispatcher. */
export function buildProgram(
  dispatcher: Dispatcher,
  stdout: NodeJS.WritableStream = process.stdout,
  stderr: NodeJS.WritableStream = process.stderr,
  helpOverrides: Readonly<Record<string, CommandHelp>> = {},
): Command {
  const program = new Command();
  program
    .name("doozctl")
    .description("Install and maintain AI repository standards.")
    .version(VERSION)
    .exitOverride()
    .configureOutput({ writeOut: (s) => stdout.write(s), writeErr: (s) => stderr.write(s) });

  const helpMap: Readonly<Record<string, CommandHelp>> = { ...COMMAND_HELP, ...helpOverrides };
  for (const name of dispatcher.commands()) {
    const command = program.command(name);
    const help = helpMap[name];
    if (help !== undefined) {
      command
        .description(help.description)
        .argument("[args...]", help.argumentDescription)
        .allowUnknownOption(true)
        .addHelpText(
          "after",
          help.helpText !== undefined
            ? `\n${help.helpText}\n`
            : `\nUsage: ${help.usage}\n\nExample: ${help.example}\n`,
        );
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
  opts: {
    stdout?: NodeJS.WritableStream;
    stderr?: NodeJS.WritableStream;
    help?: Readonly<Record<string, CommandHelp>>;
  } = {},
): Promise<number> {
  const stdout = opts.stdout ?? process.stdout;
  const stderr = opts.stderr ?? process.stderr;
  const program = buildProgram(dispatcher, stdout, stderr, opts.help);

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
    if (err instanceof UsageError) {
      stderr.write(`doozctl: ${humanizeError(err)}\n`);
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
