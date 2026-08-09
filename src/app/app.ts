import type { Engine } from "../engine/engine.js";
import type { PipelineStep } from "../engine/engine.js";
import type {
  AnalyzeDeps,
  LoadDeps,
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
import { Storage } from "../store/storage.js";

/**
 * Application Services layer: exposes the use cases the CLI commands map to.
 *
 * The app layer holds no infrastructure knowledge and never depends on any CLI
 * framework. Each command runs its own pipeline — read-only commands cannot
 * reach write.
 */

/** Infrastructure dependencies for the application. */
export interface AppDeps
  extends AnalyzeDeps, LoadDeps, MergeDeps, ValidateDeps, WriteDeps, SaveAnalysisDeps {
  /** Print a line of user-facing output (e.g. the init success report). */
  print: (message: string) => void;
}

/** Composition root of the application. */
export class App {
  private readonly engine: Engine;
  private readonly deps: AppDeps;

  constructor(engine: Engine, deps: AppDeps) {
    this.engine = engine;
    this.deps = deps;
  }

  /** init: run the full pipeline, create the manifest, and report success. */
  async init(args: string[]): Promise<number> {
    if (args.length < 2) {
      throw new Error(INIT_USAGE);
    }
    const root = args[0] as string;
    const standardsDir = args[1] as string;
    await this.run(initPipeline(this.deps), args);
    this.deps.print(this.formatInitReport(root, await this.declaredDestinations(standardsDir)));
    return 0;
  }

  /** analyze: update repository analysis only. Read-only. */
  async analyze(args: string[]): Promise<number> {
    return this.run(analyzePipeline(this.deps), args);
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
      throw new Error(SYNC_USAGE);
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
      return 0;
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
    return 0;
  }

  /** doctor: validate the repository and report. Read-only. */
  async doctor(args: string[]): Promise<number> {
    return this.run(doctorPipeline(this.deps), args);
  }

  /** summarize: append a session summary and update context. */
  async summarize(args: string[]): Promise<number> {
    return this.run(summarizePipeline(this.deps), args);
  }

  /** status: report repository status. Read-only. */
  async status(args: string[]): Promise<number> {
    return this.run(statusPipeline(this.deps), args);
  }

  private async run(steps: PipelineStep[], args: string[]): Promise<number> {
    await this.engine.run({ root: args[0] ?? ".", standardsDir: args[1] ?? "" }, steps);
    return 0;
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
