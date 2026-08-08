import type { PipelineStep } from "./engine.js";
import type {
  AnalyzeDeps,
  LoadDeps,
  MergeDeps,
  RenderDeps,
  SaveAnalysisDeps,
  ValidateDeps,
  WriteDeps,
} from "./steps.js";
import {
  analyzeStep,
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
 */

/** The full init pipeline: Analyze → Load → Resolve → Render → Merge → Validate → Write. */
export function initPipeline(
  deps: AnalyzeDeps & LoadDeps & RenderDeps & MergeDeps & ValidateDeps & WriteDeps,
): PipelineStep[] {
  return [
    analyzeStep(deps),
    loadStep(deps),
    resolveVariablesStep(),
    renderStep(deps),
    mergeStep(deps),
    validateStep(deps),
    writeStep(deps),
  ];
}

/** Analyze: update repository analysis only. Read-only; never writes artifacts. */
export function analyzePipeline(deps: AnalyzeDeps & SaveAnalysisDeps): PipelineStep[] {
  return [analyzeStep(deps), saveAnalysisStep(deps)];
}

/** Sync: re-render all managed artifacts, preserving developer content. */
export function syncPipeline(
  deps: LoadDeps & RenderDeps & MergeDeps & ValidateDeps & WriteDeps,
): PipelineStep[] {
  return [
    loadStep(deps),
    resolveVariablesStep(),
    renderStep(deps),
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
export function summarizePipeline(
  deps: RenderDeps & MergeDeps & ValidateDeps & WriteDeps,
): PipelineStep[] {
  return [
    resolveVariablesStep(),
    renderStep(deps),
    mergeStep(deps),
    validateStep(deps),
    writeStep(deps),
  ];
}

/** Status: report repository status. Read-only; never writes. */
export function statusPipeline(deps: AnalyzeDeps): PipelineStep[] {
  return [analyzeStep(deps), reportStep()];
}
