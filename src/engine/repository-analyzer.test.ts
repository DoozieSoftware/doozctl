import path from "node:path";
import { describe, expect, it } from "vitest";
import { RepositoryAnalyzer, type GitDetector } from "./repository-analyzer.js";

/**
 * Unit tests for RepositoryAnalyzer against the fixture repositories.
 *
 * Fixtures are plain directories, so git detection is stubbed to return null:
 * deterministic, offline, and independent of the surrounding repository.
 */

const fixture = (name: string): string => path.resolve("tests/fixtures", name);

const noGit: GitDetector = { detect: async () => null };

function analyze(name: string): ReturnType<RepositoryAnalyzer["analyze"]> {
  return new RepositoryAnalyzer({ git: noGit }).analyze(fixture(name));
}

describe("RepositoryAnalyzer", () => {
  it("reports a plain directory as not a git repository", async () => {
    const analysis = await analyze("fixture-node");
    expect(analysis.git).toEqual({ isRepository: false, branch: null, dirty: false });
  });

  it("resolves the analyzed root to an absolute path", async () => {
    const analysis = await analyze("fixture-node");
    expect(analysis.root).toBe(fixture("fixture-node"));
  });

  it("detects a Node.js/Express project", async () => {
    const analysis = await analyze("fixture-node");
    expect(analysis.languages).toEqual(["JavaScript"]);
    expect(analysis.frameworks).toEqual(["Express"]);
    expect(analysis.packageManager).toBe("npm");
    expect(analysis.testFramework).toBe("jest");
    expect(analysis.buildSystem).toBe("npm");
    expect(analysis.ci).toEqual([]);
    expect(analysis.docker).toBe(false);
  });

  it("counts repository statistics for the Node fixture", async () => {
    const analysis = await analyze("fixture-node");
    expect(analysis.statistics).toEqual({
      totalFiles: 7,
      sourceFiles: 4,
      testFiles: 1,
    });
  });

  it("detects AI-related files by presence only", async () => {
    const analysis = await analyze("fixture-node");
    expect(analysis.aiFiles).toEqual(["AGENTS.md"]);
  });

  it("detects a Laravel/PHP project with GitHub Actions CI", async () => {
    const analysis = await analyze("fixture-laravel");
    expect(analysis.languages).toEqual(["PHP"]);
    expect(analysis.frameworks).toEqual(["Laravel"]);
    expect(analysis.packageManager).toBe("composer");
    expect(analysis.testFramework).toBe("phpunit");
    expect(analysis.ci).toEqual(["github-actions"]);
    expect(analysis.docker).toBe(false);
    expect(analysis.buildSystem).toBeNull();
  });

  it("counts repository statistics for the Laravel fixture", async () => {
    const analysis = await analyze("fixture-laravel");
    expect(analysis.statistics).toEqual({
      totalFiles: 9,
      sourceFiles: 4,
      testFiles: 1,
    });
  });

  it("detects a React/Vite project", async () => {
    const analysis = await analyze("fixture-react");
    expect(analysis.languages).toEqual(["TypeScript"]);
    expect(analysis.frameworks).toEqual(["React"]);
    expect(analysis.packageManager).toBe("pnpm");
    expect(analysis.testFramework).toBe("vitest");
    expect(analysis.buildSystem).toBe("vite");
    expect(analysis.ci).toEqual([]);
    expect(analysis.docker).toBe(true);
  });

  it("counts repository statistics for the React fixture", async () => {
    const analysis = await analyze("fixture-react");
    expect(analysis.statistics).toEqual({
      totalFiles: 10,
      sourceFiles: 5,
      testFiles: 1,
    });
  });

  it("detects an empty repository", async () => {
    const analysis = await analyze("fixture-empty");
    expect(analysis.languages).toEqual([]);
    expect(analysis.frameworks).toEqual([]);
    expect(analysis.packageManager).toBeNull();
    expect(analysis.testFramework).toBeNull();
    expect(analysis.buildSystem).toBeNull();
    expect(analysis.ci).toEqual([]);
    expect(analysis.docker).toBe(false);
    expect(analysis.aiFiles).toEqual([]);
    expect(analysis.statistics).toEqual({ totalFiles: 1, sourceFiles: 0, testFiles: 0 });
  });
});
