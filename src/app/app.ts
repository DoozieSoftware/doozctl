import type { Engine, ExecutionContext, PipelineStep } from "../engine/engine.js";
import type {
  AnalyzeDeps,
  LoadDeps,
  LoadStateDeps,
  MergeDeps,
  SaveAnalysisDeps,
  ValidateDeps,
  WriteDeps,
} from "../engine/steps.js";
import {
  analyzePipeline,
  doctorPipeline,
  initPipeline,
  statusPipeline,
  summarizePipeline,
  syncPipeline,
} from "../engine/pipelines.js";
import { formatSessionId, toLocalIso } from "../engine/session.js";
import { isValidPlanId, planFilename, type Plan } from "../model/plan.js";
import type { SessionInput } from "../model/model.js";
import { PlanStore } from "../store/plan-store.js";
import { Storage } from "../store/storage.js";
import {
  DEFAULT_METHOD,
  isValidWorkflowMethodId,
  resolveAdoptedWorkflow,
  type AdoptedWorkflow,
} from "../workflows/adoption.js";
import { UsageError } from "../errors.js";
import { ExitCode } from "../dispatcher/dispatcher.js";
import { readFile } from "node:fs/promises";

/**
 * Application Services layer: exposes the use cases the CLI commands map to.
 *
 * The app layer holds no infrastructure knowledge and never depends on any CLI
 * framework. Each command runs its own pipeline — read-only commands cannot
 * reach write.
 */

/** Infrastructure dependencies for the application. */
export interface AppDeps
  extends
    AnalyzeDeps,
    LoadDeps,
    LoadStateDeps,
    MergeDeps,
    ValidateDeps,
    WriteDeps,
    SaveAnalysisDeps {
  /** Print a line of user-facing output (e.g. the init success report). */
  print: (message: string) => void;
  /** Clock used to derive session ids and timestamps. */
  now: () => Date;
}

/** Composition root of the application. */
export class App {
  private readonly engine: Engine;
  private readonly deps: AppDeps;
  private readonly planStore: PlanStore;

  constructor(engine: Engine, deps: AppDeps) {
    this.engine = engine;
    this.deps = deps;
    this.planStore = new PlanStore({ now: deps.now });
  }

  /** init: run the full pipeline, create the manifest, and report success. */
  async init(args: string[]): Promise<number> {
    if (args.length < 2) {
      throw new UsageError(INIT_USAGE);
    }
    const root = args[0] as string;
    const standardsDir = args[1] as string;
    await this.run(initPipeline(this.deps), args);
    this.deps.print(this.formatInitReport(root, await this.declaredDestinations(standardsDir)));
    return ExitCode.OK;
  }

  /** analyze: re-analyze the repository and update the repository memory
   * (`.ai/repository-analysis.json`). Requires an initialized repository.
   */
  async analyze(args: string[]): Promise<number> {
    await this.run(analyzePipeline(this.deps), args);
    return ExitCode.OK;
  }

  /**
   * sync: re-render the managed artifacts in the sync lifecycle from the
   * persisted repository state, preserving developer content, and print a
   * summary. Artifacts outside the sync lifecycle are skipped and reported.
   * Never partially synchronizes — the pipeline short-circuits before writing
   * if any merge fails, leaving the repository unchanged.
   */
  async sync(args: string[]): Promise<number> {
    if (args.length < 2) {
      throw new UsageError(SYNC_USAGE);
    }
    const root = args[0] as string;
    const standardsDir = args[1] as string;

    this.deps.print("Synchronizing repository...");
    this.deps.print("");

    const pkg = await this.deps.loader.load(standardsDir);
    const active = pkg.artifacts.filter((artifact) => artifact.lifecycle.includes("sync"));
    const skipped = pkg.artifacts.length - active.length;
    const destinations = active.map((artifact) => artifact.destination.path);
    const before = await this.snapshotDestinations(root, destinations);

    await this.run(syncPipeline(this.deps), args);

    const after = await this.snapshotDestinations(root, destinations);
    const updated = destinations.filter((dest) => before.get(dest) !== after.get(dest)).length;

    if (skipped > 0) {
      this.deps.print(`✓ Skipped ${skipped} artifacts (not in sync lifecycle)`);
      this.deps.print("");
    }

    if (updated === 0) {
      this.deps.print("✓ Repository already up to date.");
      this.deps.print("");
      this.deps.print("No changes required.");
      return ExitCode.OK;
    }

    this.deps.print("✓ Loaded repository state");
    this.deps.print("✓ Loaded Standards Package");
    this.deps.print(`✓ Rendered ${destinations.length} artifacts`);
    this.deps.print(`✓ Updated ${updated} artifacts`);
    this.deps.print(`✓ Unchanged ${destinations.length - updated} artifacts`);
    this.deps.print("");
    this.deps.print("Done.");
    this.deps.print("");
    this.deps.print("Repository synchronized successfully.");
    return ExitCode.OK;
  }

  /**
   * doctor: validate the repository and report. Read-only. Returns exit code 1
   * when problems are found so scripts can gate on repository health.
   */
  async doctor(args: string[]): Promise<number> {
    if (args.length < 2) {
      throw new UsageError(DOCTOR_USAGE);
    }
    const ctx = await this.run(doctorPipeline(this.deps), args);
    return ctx.doctorProblems.length > 0 ? ExitCode.Error : ExitCode.OK;
  }

  /**
   * summarize: append an immutable session summary and rewrite the current
   * context. The session summary is read from a file; tool, model and user are
   * optional flags; id, date, commit and branch are derived automatically.
   */
  async summarize(args: string[]): Promise<number> {
    const parsed = parseSummarizeArgs(args);
    if (parsed.positionals.length < 3) {
      throw new UsageError(SUMMARIZE_USAGE);
    }
    const root = parsed.positionals[0] as string;
    const standardsDir = parsed.positionals[1] as string;
    const sessionFile = parsed.positionals[2] as string;

    let content: string;
    try {
      content = await readFile(sessionFile, "utf-8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`session file not found: ${sessionFile}`);
      }
      throw error;
    }

    const now = this.deps.now();
    const input: SessionInput = {
      id: formatSessionId(now),
      date: toLocalIso(now),
      content,
      tool: parsed.flags.tool ?? "",
      model: parsed.flags.model ?? "",
      user: parsed.flags.user ?? "",
    };

    const pkg = await this.deps.loader.load(standardsDir);
    const summarizeArtifacts = pkg.artifacts.filter((artifact) =>
      artifact.lifecycle.includes("summarize"),
    );
    const hasSession = summarizeArtifacts.some((artifact) => artifact.mergeStrategy === "append");
    const hasContext = summarizeArtifacts.some(
      (artifact) => artifact.mergeStrategy === "overwrite",
    );

    this.deps.print("Summarizing repository...");
    this.deps.print("");
    await this.run(summarizePipeline(this.deps, input), [root, standardsDir]);
    if (hasSession) {
      this.deps.print(`✓ Appended session .ai/sessions/${input.id}.md`);
    }
    if (hasContext) {
      this.deps.print("✓ Updated current context");
    }
    this.deps.print("");
    this.deps.print("Done.");
    return ExitCode.OK;
  }

  /** status: report repository status. Read-only. */
  async status(args: string[]): Promise<number> {
    await this.run(statusPipeline(this.deps), args);
    return ExitCode.OK;
  }

  /**
   * plan: create a repository-local engineering Plan under
   * `.dooz/plans/active/`. The method resolves through the repository's
   * adopted workflows (`standard` by default) and must be adopted to succeed;
   * the plan id is derived from --title when given, otherwise it is the method
   * id. A collision never overwrites.
   */
  async plan(args: string[]): Promise<number> {
    const parsed = parsePlanArgs(args);
    const root = parsed.repo ?? ".";
    const method = await this.resolveWorkflow(root, parsed.method ?? DEFAULT_METHOD);

    const id = parsed.title === undefined ? method.id : kebabize(parsed.title);
    if (!isValidPlanId(id)) {
      throw new UsageError(
        '--title must produce a valid plan id (lowercase kebab-case). Example: --title "attendance punch sync" creates id attendance-punch-sync.',
      );
    }

    const plan = await this.planStore.create(
      root,
      parsed.title === undefined
        ? { id, method: method.id }
        : { id, method: method.id, title: parsed.title },
    );
    this.deps.print(this.formatPlanReport(plan));
    return ExitCode.OK;
  }

  /**
   * Resolve a workflow method id against the repository control plane,
   * mapping an unadopted or invalid id to a usage error.
   */
  private async resolveWorkflow(root: string, methodId: string): Promise<AdoptedWorkflow> {
    if (!isValidWorkflowMethodId(methodId)) {
      throw new UsageError(
        `invalid plan method: ${methodId}. Workflow method ids are lowercase kebab-case (e.g. bug-fix).`,
      );
    }
    try {
      return await resolveAdoptedWorkflow(root, methodId);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("workflow method not adopted:")) {
        throw new UsageError(
          `unknown plan method: ${methodId} — the repository has not adopted this workflow. ` +
            "Adopt it by adding .dooz/workflows/adopted/<id>.md or .dooz/workflows/project/<id>.md.",
        );
      }
      throw error;
    }
  }

  /** The concise creation report printed to the user. */
  private formatPlanReport(plan: Plan): string {
    return [
      "Created plan:",
      `  ID: ${plan.id}`,
      `  Method: ${plan.method}`,
      `  Status: ${plan.status}`,
      `  Path: .dooz/plans/active/${planFilename(plan.created, plan.id)}`,
    ].join("\n");
  }

  private async run(steps: PipelineStep[], args: string[]): Promise<ExecutionContext> {
    return this.engine.run({ root: args[0] ?? ".", standardsDir: args[1] ?? "" }, steps);
  }

  /** The declared init-lifecycle destinations, sorted, for the init report. */
  private async declaredDestinations(standardsDir: string): Promise<string[]> {
    try {
      const pkg = await this.deps.loader.load(standardsDir);
      return pkg.artifacts
        .filter((artifact) => artifact.lifecycle.includes("init"))
        .map((artifact) => artifact.destination.path)
        .sort();
    } catch {
      return [];
    }
  }

  /** Snapshot each destination's current content, so sync can report updated vs unchanged. */
  private async snapshotDestinations(
    root: string,
    destinations: string[],
  ): Promise<Map<string, string>> {
    const repo = new Storage(root);
    const snapshot = new Map<string, string>();
    for (const dest of destinations) {
      let content: string;
      try {
        content = await repo.read(dest);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          content = "";
        } else {
          throw error;
        }
      }
      snapshot.set(dest, content);
    }
    return snapshot;
  }

  private formatInitReport(root: string, destinations: string[]): string {
    const artifacts = destinations.length > 0 ? destinations.map((d) => `  - ${d}`) : ["  (none)"];
    return [
      `Repository initialized: ${root}`,
      "",
      "Generated artifacts:",
      ...artifacts,
      "",
      "Engine state:      .dooz/manifest.json",
      "Repository memory: .ai/repository-analysis.json",
    ].join("\n");
  }
}

/** User-facing usage for init, shown when arguments are missing. */
const INIT_USAGE = [
  "init requires a repository path and a Standards Package directory.",
  "",
  "Usage:   doozctl init <repo> <package>",
  "Example: doozctl init . ./standards",
].join("\n");

/** User-facing usage for sync, shown when arguments are missing. */
const SYNC_USAGE = [
  "sync requires a repository path and a Standards Package directory.",
  "",
  "Usage:   doozctl sync <repo> <package>",
  "Example: doozctl sync . ./standards",
].join("\n");

/** User-facing usage for doctor, shown when arguments are missing. */
const DOCTOR_USAGE = [
  "doctor requires a repository path and a Standards Package directory.",
  "",
  "Usage:   doozctl doctor <repo> <package>",
  "Example: doozctl doctor . ./standards",
].join("\n");

/** User-facing usage for summarize, shown when arguments are missing. */
const SUMMARIZE_USAGE = [
  "summarize requires a repository path, a Standards Package directory, and a session file.",
  "",
  "Usage:   doozctl summarize <repo> <package> <session-file> [--tool <tool>] [--model <model>] [--user <user>]",
  "Example: doozctl summarize . ./standards .ai/pending.md --tool claude --model opus --user akshay",
].join("\n");

/** User-facing usage for plan, shown when the arguments are invalid. */
const PLAN_USAGE = [
  "plan creates a Plan under .dooz/plans/active/.",
  "",
  "Usage:   doozctl plan [repo] [--method <method>] [--title <title>]",
  "Example: doozctl plan --method bug-fix",
].join("\n");

/**
 * Split plan args into an optional repo positional and the --method/--title
 * flags. Mirrors the summarize argument parsing: flags are consumed here, not
 * by the CLI framework.
 */
function parsePlanArgs(args: string[]): {
  repo: string | undefined;
  method: string | undefined;
  title: string | undefined;
} {
  const positionals: string[] = [];
  let method: string | undefined;
  let title: string | undefined;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] as string;
    if (arg === "--method" || arg === "--title") {
      const value = args[i + 1];
      if (value === undefined || value.startsWith("-")) {
        throw new UsageError(`${arg} requires a value`);
      }
      if (arg === "--method") {
        method = value;
      } else {
        title = value;
      }
      i += 1;
    } else if (arg.startsWith("--method=")) {
      method = arg.slice("--method=".length);
    } else if (arg.startsWith("--title=")) {
      title = arg.slice("--title=".length);
    } else if (arg.startsWith("-")) {
      throw new UsageError(`unknown option: ${arg}`);
    } else {
      positionals.push(arg);
    }
  }
  if (positionals.length > 1) {
    throw new UsageError(PLAN_USAGE);
  }
  return { repo: positionals[0], method, title };
}

/** Derive a kebab-case plan id from a human title. */
function kebabize(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The session metadata flags summarize accepts. */
type SessionFlag = "tool" | "model" | "user";

/** Split summarize args into positional arguments and session metadata flags. */
function parseSummarizeArgs(args: string[]): {
  positionals: string[];
  flags: Partial<Record<SessionFlag, string>>;
} {
  const positionals: string[] = [];
  const flags: Partial<Record<SessionFlag, string>> = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] as string;
    const match = /^--(tool|model|user)$/.exec(arg);
    if (match !== null) {
      const name = match[1] as SessionFlag;
      const value = args[i + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`--${name} requires a value`);
      }
      flags[name] = value;
      i += 1;
    } else {
      positionals.push(arg);
    }
  }
  return { positionals, flags };
}
