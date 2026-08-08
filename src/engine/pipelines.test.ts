import { describe, expect, it } from "vitest";
import type { PipelineStep } from "./engine.js";
import {
  analyzePipeline,
  doctorPipeline,
  initPipeline,
  statusPipeline,
  summarizePipeline,
  syncPipeline,
} from "./pipelines.js";
import type {
  AnalyzeDeps,
  LoadDeps,
  MergeDeps,
  RenderDeps,
  SaveAnalysisDeps,
  ValidateDeps,
  WriteDeps,
} from "./steps.js";

const deps = {
  git: {},
  analyzer: {},
  loader: {},
  renderer: {},
  mergers: {},
  validator: {},
  fs: {},
  store: {},
} as AnalyzeDeps & LoadDeps & RenderDeps & MergeDeps & ValidateDeps & WriteDeps & SaveAnalysisDeps;

describe("command pipelines", () => {
  it("init runs the full seven-stage pipeline", () => {
    const steps = initPipeline(deps);
    expect(steps).toHaveLength(7);
  });

  it("analyze is read-only and never writes", () => {
    const steps = analyzePipeline(deps);
    expect(steps).toHaveLength(2);
    expect(steps.map(fnOf)).not.toContain("writeStep");
  });

  it("sync re-renders without re-analyzing", () => {
    const steps = syncPipeline(deps);
    expect(steps.map(fnOf)).not.toContain("analyzeStep");
    expect(steps.map(fnOf)).toContain("mergeStep");
    expect(steps.map(fnOf)).toContain("writeStep");
  });

  it("doctor is validate + report and never writes", () => {
    const steps = doctorPipeline(deps);
    expect(steps.map(fnOf)).toEqual(["validateStep", "reportStep"]);
  });

  it("status is read-only and never writes", () => {
    const steps = statusPipeline(deps);
    expect(steps.map(fnOf)).not.toContain("writeStep");
  });

  it("summarize appends a session", () => {
    const steps = summarizePipeline(deps);
    expect(steps.map(fnOf)).toContain("writeStep");
    expect(steps.map(fnOf)).toContain("mergeStep");
  });
});

/** Extracts a step's factory name for structural assertions. */
function fnOf(step: PipelineStep): string {
  return (step as unknown as { name?: string }).name ?? "?";
}
