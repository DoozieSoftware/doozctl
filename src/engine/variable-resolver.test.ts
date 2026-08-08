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
    aiFiles: ["AGENTS.md"],
    ...overrides,
  };
}

describe("resolveVariables", () => {
  it("names analysis facts under the analysis namespace", () => {
    expect(resolveVariables(analysis())).toEqual({
      analysis: {
        language: ["TypeScript"],
        framework: ["React"],
        tests: "vitest",
        root: "/tmp/repo",
        git: { isRepository: true, branch: "main", dirty: false },
        buildSystem: "vite",
        packageManager: "pnpm",
        ci: ["github-actions"],
        docker: true,
        statistics: { totalFiles: 10, sourceFiles: 5, testFiles: 1 },
        aiFiles: ["AGENTS.md"],
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
        aiFiles: [],
      }),
    );
    expect(vars).toEqual({
      analysis: {
        language: [],
        framework: [],
        tests: null,
        root: "/tmp/repo",
        git: { isRepository: true, branch: "main", dirty: false },
        buildSystem: null,
        packageManager: null,
        ci: [],
        docker: false,
        statistics: { totalFiles: 10, sourceFiles: 5, testFiles: 1 },
        aiFiles: [],
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
