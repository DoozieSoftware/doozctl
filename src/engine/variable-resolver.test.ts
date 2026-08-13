import { describe, expect, it } from "vitest";
import type { Analysis } from "../model/model.js";
import { resolveVariables } from "./variable-resolver.js";

/** Build an analysis with a stable default shape. */
function analysis(overrides: Partial<Analysis> = {}): Analysis {
  return {
    root: "/tmp/repo",
    git: { isRepository: true, branch: "main", dirty: false },
    languages: ["TypeScript"],
    frameworks: ["React"],
    buildSystem: "vite",
    packageManager: "pnpm",
    testFramework: "vitest",
    ci: ["github-actions"],
    docker: true,
    statistics: { totalFiles: 10, sourceFiles: 5, testFiles: 1 },
    ...overrides,
  };
}

describe("resolveVariables", () => {
  it("groups analysis facts into analysis, repository and build namespaces", () => {
    expect(resolveVariables(analysis())).toEqual({
      analysis: {
        language: ["TypeScript"],
        framework: ["React"],
        tests: "vitest",
      },
      repository: {
        root: "/tmp/repo",
        git: { isRepository: true, branch: "main", dirty: false },
        statistics: { totalFiles: 10, sourceFiles: 5, testFiles: 1 },
      },
      build: {
        buildSystem: "vite",
        packageManager: "pnpm",
        ci: ["github-actions"],
        docker: true,
      },
    });
  });

  it("maps absent analysis facts to null or empty values", () => {
    const vars = resolveVariables(
      analysis({
        languages: [],
        frameworks: [],
        buildSystem: null,
        packageManager: null,
        testFramework: null,
        ci: [],
        docker: false,
      }),
    );
    expect(vars).toEqual({
      analysis: {
        language: [],
        framework: [],
        tests: null,
      },
      repository: {
        root: "/tmp/repo",
        git: { isRepository: true, branch: "main", dirty: false },
        statistics: { totalFiles: 10, sourceFiles: 5, testFiles: 1 },
      },
      build: {
        buildSystem: null,
        packageManager: null,
        ci: [],
        docker: false,
      },
    });
  });

  it("produces identical variables for identical analyses", () => {
    expect(resolveVariables(analysis())).toEqual(resolveVariables(analysis()));
  });

  it("serializes to plain JSON without losing data", () => {
    const vars = resolveVariables(analysis());
    expect(JSON.parse(JSON.stringify(vars))).toEqual(vars);
  });
});
