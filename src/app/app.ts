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
  extends AnalyzeDeps, LoadDeps, MergeDeps, ValidateDeps, WriteDeps, SaveAnalysisDeps {}

/** Composition root of the application. */
export class App {
  private readonly engine: Engine;
  private readonly deps: AppDeps;

  constructor(engine: Engine, deps: AppDeps) {
    this.engine = engine;
    this.deps = deps;
  }

  /** init: run the full pipeline and create the manifest. */
  async init(args: string[]): Promise<number> {
    return this.run(initPipeline(this.deps), args);
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
}
