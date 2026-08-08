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

  /** sync: re-render managed artifacts, preserving developer content. */
  async sync(args: string[]): Promise<number> {
    return this.run(syncPipeline(this.deps), args);
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

  /** The declared artifact destinations, sorted, for the success report. */
  private async declaredDestinations(standardsDir: string): Promise<string[]> {
    try {
      const pkg = await this.deps.loader.load(standardsDir);
      return pkg.artifacts.map((artifact) => artifact.destination.path).sort();
    } catch {
      return [];
    }
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
