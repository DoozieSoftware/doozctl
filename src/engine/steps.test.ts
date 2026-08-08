import { describe, expect, it } from "vitest";
import { NotImplementedError } from "../errors.js";
import { Engine, type PipelineStep } from "./engine.js";
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

/** Minimal stand-in dependencies for scaffolding tests. */
const deps = {
  git: {} as never,
  analyzer: {} as never,
  loader: {} as never,
  renderer: {} as never,
  mergers: {} as never,
  validator: {} as never,
  fs: {} as never,
  store: {} as never,
};

function runStep(step: PipelineStep): Promise<unknown> {
  return new Engine().run({ root: ".", standardsDir: "" }, [step]);
}

describe("pipeline steps", () => {
  it("analyze step is scaffolding", async () => {
    await expect(runStep(analyzeStep(deps as AnalyzeDeps))).rejects.toBeInstanceOf(
      NotImplementedError,
    );
  });

  it("load step is scaffolding", async () => {
    await expect(runStep(loadStep(deps as LoadDeps))).rejects.toBeInstanceOf(NotImplementedError);
  });

  it("resolveVariables step is scaffolding", async () => {
    await expect(runStep(resolveVariablesStep())).rejects.toBeInstanceOf(NotImplementedError);
  });

  it("render step is scaffolding", async () => {
    await expect(runStep(renderStep(deps as RenderDeps))).rejects.toBeInstanceOf(
      NotImplementedError,
    );
  });

  it("merge step is scaffolding", async () => {
    await expect(runStep(mergeStep(deps as MergeDeps))).rejects.toBeInstanceOf(NotImplementedError);
  });

  it("validate step is scaffolding", async () => {
    await expect(runStep(validateStep(deps as ValidateDeps))).rejects.toBeInstanceOf(
      NotImplementedError,
    );
  });

  it("write step is scaffolding", async () => {
    await expect(runStep(writeStep(deps as WriteDeps))).rejects.toBeInstanceOf(NotImplementedError);
  });

  it("saveAnalysis step is scaffolding", async () => {
    await expect(runStep(saveAnalysisStep(deps as SaveAnalysisDeps))).rejects.toBeInstanceOf(
      NotImplementedError,
    );
  });

  it("report step is scaffolding", async () => {
    await expect(runStep(reportStep())).rejects.toBeInstanceOf(NotImplementedError);
  });
});
