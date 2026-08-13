import type {
  Analysis,
  Artifact,
  Manifest,
  RenderedArtifact,
  StandardsPackage,
  Variables,
} from "../model/model.js";

/**
 * Core Engine: runs the standardized pipeline as a sequence of independent
 * steps, in order, short-circuiting on the first failure.
 *
 * The engine is only a step runner. It holds no standards-specific behavior
 * and knows nothing about individual steps.
 */

/**
 * Execution data threaded through the pipeline.
 *
 * Execution data belongs here; infrastructure (filesystem, git, store) belongs
 * in constructor injection at the step factories. This is not a service
 * locator.
 */
export interface ExecutionContext {
  /** Repository directory. */
  root: string;
  /** Standards Package directory. */
  standardsDir: string;
  /** Factual repository metadata (filled by analyze). */
  analysis: Analysis | null;
  /** Variables resolved for rendering (filled by resolveVariables). */
  variables: Variables;
  /** Loaded Standards Package (filled by load). */
  standards: StandardsPackage | null;
  /** In-flight artifacts (filled by load, consumed by render/write). */
  artifacts: Artifact[];
  /** Engine manifest, when the run loaded repository state (filled by loadState). */
  manifest: Manifest | null;
  /** Rendered artifacts (filled by render, consumed by merge/write). */
  rendered: RenderedArtifact[];
  /** Merged artifacts (filled by merge, consumed by write). */
  merged: RenderedArtifact[];
  /** Problems the doctor step found; empty when the repository is healthy. */
  doctorProblems: string[];
}

/** A single pipeline step. */
export type PipelineStep = (ctx: ExecutionContext) => Promise<void>;

/** Options configuring a pipeline run. */
export interface EngineOptions {
  root: string;
  standardsDir: string;
}

/** Executes the given pipeline steps in order, returning the execution context. */
export class Engine {
  async run(options: EngineOptions, steps: PipelineStep[]): Promise<ExecutionContext> {
    const ctx: ExecutionContext = {
      root: options.root,
      standardsDir: options.standardsDir,
      analysis: null,
      variables: {},
      standards: null,
      artifacts: [],
      manifest: null,
      rendered: [],
      merged: [],
      doctorProblems: [],
    };
    for (const step of steps) {
      await step(ctx);
    }
    return ctx;
  }
}
