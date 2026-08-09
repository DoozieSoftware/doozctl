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
  SaveAnalysisDeps,
  ValidateDeps,
  WriteDeps,
} from "./steps.js";

const deps = {
  git: {},
  analyzer: {},
  loader: {},
  mergers: {},
  validator: {},
  store: {},
} as AnalyzeDeps & LoadDeps & MergeDeps & ValidateDeps & WriteDeps & SaveAnalysisDeps;

describe("command pipelines", () => {
  it("init runs the full eight-stage pipeline", () => {
    const steps = initPipeline(deps);
    expect(steps).toHaveLength(8);
  });

  it("init filters artifacts to the init lifecycle", () => {
    expect(initPipeline(deps).map(fnOf)).toContain("lifecycleStep");
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
    expect(steps.map(fnOf)).toContain("lifecycleStep");
  });

  it("doctor is validate + report and never writes", () => {
    const steps = doctorPipeline(deps);
    expect(steps.map(fnOf)).toEqual(["validateStep", "reportStep"]);
  });

  it("status is read-only and never writes", () => {
    const steps = statusPipeline(deps);
    expect(steps.map(fnOf)).not.toContain("writeStep");
  });

  it("summarize appends a session and filters to the summarize lifecycle", () => {
    const steps = summarizePipeline(deps, {
      id: "2026-08-09_093000",
      date: "2026-08-09T09:30:00+08:00",
      content: "",
      tool: "",
      model: "",
      user: "",
    });
    expect(steps.map(fnOf)).toContain("writeStep");
    expect(steps.map(fnOf)).toContain("mergeStep");
    expect(steps.map(fnOf)).toContain("lifecycleStep");
    expect(steps.map(fnOf)).toContain("loadStateStep");
    expect(steps.map(fnOf)).not.toContain("analyzeStep");
  });
});

/** Extracts a step's factory name for structural assertions. */
function fnOf(step: PipelineStep): string {
  return (step as unknown as { name?: string }).name ?? "?";
}
