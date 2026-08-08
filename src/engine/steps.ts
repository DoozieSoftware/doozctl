import { NotImplementedError } from "../errors.js";
import type { GitService } from "../infra/git/git.js";
import type { RepositoryStore } from "../store/repository-store.js";
import type { Storage } from "../store/storage.js";
import type { ExecutionContext, PipelineStep } from "./engine.js";
import type {
  Analyzer,
  Renderer,
  StandardsLoader,
  StrategyMerger,
  Validator,
} from "./contracts.js";
import type { MergeStrategy } from "../model/model.js";

/**
 * Pipeline steps. Each step is an independent function operating on the shared
 * ExecutionContext. Steps are built by factories that receive their
 * infrastructure dependencies via constructor injection.
 *
 * Steps are scaffolding until a later phase implements them.
 */

const stub = (name: string): PipelineStep => {
  const step: PipelineStep = async (_ctx: ExecutionContext): Promise<void> => {
    throw new NotImplementedError(`engine.${name}`);
  };
  Object.defineProperty(step, "name", { value: `${name}Step`, configurable: true });
  return step;
};
/** Dependencies for the analyze step. */
export interface AnalyzeDeps {
  git: GitService;
  analyzer: Analyzer;
}

/** Analyze: produce factual repository metadata. */
export function analyzeStep(_deps: AnalyzeDeps): PipelineStep {
  return stub("analyze");
}

/** Dependencies for the load step. */
export interface LoadDeps {
  loader: StandardsLoader;
}

/** Load: load the Standards Package manifest. */
export function loadStep(_deps: LoadDeps): PipelineStep {
  return stub("load");
}

/** Resolve Variables: derive render variables from the analysis. */
export function resolveVariablesStep(): PipelineStep {
  return stub("resolveVariables");
}

/** Dependencies for the render step. */
export interface RenderDeps {
  renderer: Renderer;
}

/** Render: render each artifact from its source template. */
export function renderStep(_deps: RenderDeps): PipelineStep {
  return stub("render");
}

/** Dependencies for the merge step. */
export interface MergeDeps {
  mergers: Record<MergeStrategy, StrategyMerger>;
}

/** Merge: combine rendered content with existing files per merge strategy. */
export function mergeStep(_deps: MergeDeps): PipelineStep {
  return stub("merge");
}

/** Dependencies for the validate step. */
export interface ValidateDeps {
  validator: Validator;
}

/** Validate: check artifacts against their schemas. */
export function validateStep(_deps: ValidateDeps): PipelineStep {
  return stub("validate");
}

/** Dependencies for the write step. */
export interface WriteDeps {
  fs: Storage;
  store: RepositoryStore;
}

/** Write: persist merged artifacts and update the manifest. */
export function writeStep(_deps: WriteDeps): PipelineStep {
  return stub("write");
}

/** Dependencies for the save-analysis step. */
export interface SaveAnalysisDeps {
  store: RepositoryStore;
}

/** Save Analysis: persist repository analysis (read-only command). */
export function saveAnalysisStep(_deps: SaveAnalysisDeps): PipelineStep {
  return stub("saveAnalysis");
}

/** Report: produce a human-readable report for read-only commands. */
export function reportStep(): PipelineStep {
  return stub("report");
}
