import type { PipelineStep } from "./engine.js";
import type {
  AnalyzeDeps,
  LoadDeps,
  LoadStateDeps,
  MergeDeps,
  SaveAnalysisDeps,
  ValidateDeps,
  WriteDeps,
} from "./steps.js";
import {
  analyzeStep,
  loadRepositoryStateStep,
  loadStep,
  mergeStep,
  renderStep,
  reportStep,
  resolveVariablesStep,
  saveAnalysisStep,
  validateStep,
  writeStep,
} from "./steps.js";

/**
 * Command-specific pipelines.
 *
 * Every command does not run the same pipeline. Read-only commands (analyze,
 * status) never reach write; doctor is validate + report; summarize appends a
 * session. init is the only command that runs the full seven-stage pipeline.
 * sync re-renders from persisted repository state (it never re-analyzes).
 */

/** The full init pipeline: Analyze → Load → Resolve → Render → Merge → Validate → Write. */
export function initPipeline(
  deps: AnalyzeDeps & LoadDeps & MergeDeps & ValidateDeps & WriteDeps,
): PipelineStep[] {
  return [
    analyzeStep(deps),
    loadStep(deps),
    resolveVariablesStep(),
    renderStep(),
    mergeStep(deps),
    validateStep(deps),
    writeStep(deps),
  ];
}

/** Analyze: update repository analysis only. Read-only; never writes artifacts. */
export function analyzePipeline(deps: AnalyzeDeps & SaveAnalysisDeps): PipelineStep[] {
  return [analyzeStep(deps), saveAnalysisStep(deps)];
}

/**
 * Sync: re-render all managed artifacts from the persisted repository state,
 * preserving developer content. Loads the stored analysis instead of
 * re-analyzing so repeated runs are deterministic. Existing managed artifacts
 * are read by the merge stage.
 */
export function syncPipeline(
  deps: LoadStateDeps & LoadDeps & MergeDeps & ValidateDeps & WriteDeps,
): PipelineStep[] {
  return [
    loadRepositoryStateStep(deps),
    loadStep(deps),
    resolveVariablesStep(),
    renderStep(),
    mergeStep(deps),
    validateStep(deps),
    writeStep(deps),
  ];
}

/** Doctor: validate the repository and report problems. Never writes. */
export function doctorPipeline(deps: ValidateDeps): PipelineStep[] {
  return [validateStep(deps), reportStep()];
}

/** Summarize: append an immutable session and update context. */
export function summarizePipeline(deps: MergeDeps & ValidateDeps & WriteDeps): PipelineStep[] {
  return [
    resolveVariablesStep(),
    renderStep(),
    mergeStep(deps),
    validateStep(deps),
    writeStep(deps),
  ];
}

/** Status: report repository status. Read-only; never writes. */
export function statusPipeline(deps: AnalyzeDeps): PipelineStep[] {
  return [analyzeStep(deps), reportStep()];
}
