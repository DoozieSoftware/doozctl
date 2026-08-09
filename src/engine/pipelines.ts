import type { PipelineStep } from "./engine.js";
import type { SessionInput } from "../model/model.js";
import type {
  AnalyzeDeps,
  LoadDeps,
  LoadStateDeps,
  MergeDeps,
  ReportDeps,
  SaveAnalysisDeps,
  SessionDeps,
  ValidateDeps,
  WriteDeps,
} from "./steps.js";
import {
  analyzeStep,
  lifecycleStep,
  loadRepositoryStateStep,
  loadStep,
  mergeStep,
  renderStep,
  reportStep,
  resolveDestinationStep,
  resolveVariablesStep,
  saveAnalysisStep,
  sessionStep,
  validateStep,
  writeStep,
} from "./steps.js";

/**
 * Command-specific pipelines.
 *
 * Every command does not run the same pipeline. Read-only commands (status)
 * never reach write; doctor is validate + report; summarize appends a session;
 * analyze persists the repository analysis but never writes artifacts. init is
 * the only command that runs the full seven-stage pipeline. sync re-renders
 * from persisted repository state (it never re-analyzes).
 */

/** The full init pipeline: Analyze → Load → Lifecycle → Resolve → Render → Merge → Validate → Write. */
export function initPipeline(
  deps: AnalyzeDeps & LoadDeps & MergeDeps & ValidateDeps & WriteDeps,
): PipelineStep[] {
  return [
    analyzeStep(deps),
    loadStep(deps),
    lifecycleStep("init"),
    resolveVariablesStep(),
    renderStep(),
    mergeStep(deps),
    validateStep(deps),
    writeStep(deps),
  ];
}

/** Analyze: re-analyze and persist the repository analysis. Never writes artifacts. */
export function analyzePipeline(
  deps: AnalyzeDeps & SaveAnalysisDeps & LoadStateDeps,
): PipelineStep[] {
  return [loadRepositoryStateStep(deps), analyzeStep(deps), saveAnalysisStep(deps)];
}

/**
 * Sync: re-render the managed artifacts in the sync lifecycle from the
 * persisted repository state, preserving developer content. Loads the stored
 * analysis instead of re-analyzing so repeated runs are deterministic. Existing
 * managed artifacts are read by the merge stage.
 */
export function syncPipeline(
  deps: LoadStateDeps & LoadDeps & MergeDeps & ValidateDeps & WriteDeps,
): PipelineStep[] {
  return [
    loadRepositoryStateStep(deps),
    loadStep(deps),
    lifecycleStep("sync"),
    resolveVariablesStep(),
    renderStep(),
    mergeStep(deps),
    validateStep(deps),
    writeStep(deps),
  ];
}

/**
 * Doctor: verify the repository is initialized and the Standards Package
 * loads, then report health problems. Never writes. The load-state step
 * short-circuits with a clear error when the repository is not initialized.
 */
export function doctorPipeline(deps: LoadStateDeps & LoadDeps & ReportDeps): PipelineStep[] {
  return [loadRepositoryStateStep(deps), loadStep(deps), reportStep(deps, "doctor")];
}

/**
 * Summarize: verify initialization, keep summarize-lifecycle artifacts, build
 * the session variables, append the immutable session file, and rewrite the
 * current context. Never re-analyzes: it loads the persisted repository state
 * and repository analysis.
 */
export function summarizePipeline(
  deps: LoadStateDeps & LoadDeps & MergeDeps & ValidateDeps & WriteDeps & SessionDeps,
  input: SessionInput,
): PipelineStep[] {
  return [
    loadRepositoryStateStep(deps),
    loadStep(deps),
    lifecycleStep("summarize"),
    resolveVariablesStep(),
    sessionStep(deps, input),
    resolveDestinationStep(),
    renderStep(),
    mergeStep(deps),
    validateStep(deps),
    writeStep(deps),
  ];
}

/** Status: report what DoozCTL understands about the repository. Read-only; never writes. */
export function statusPipeline(deps: AnalyzeDeps & ReportDeps): PipelineStep[] {
  return [analyzeStep(deps), reportStep(deps, "status")];
}
