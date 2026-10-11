import { describe, expect, it } from "vitest";
import { parseBaseline, renderBaseline, type BaselineFields } from "./baseline.js";
import { parsePlan, renderPlan } from "./plan.js";
import { isDirectoryScope, isValidScopePath, scopeFromBaseline, scopePathError } from "./scope.js";

/**
 * V3-P05 unit tests for the scope model: D5 declarations (exact paths and
 * directory prefixes, no globs), validation over the existing `## Baseline`
 * metadata, determinism, and v2 backward compatibility.
 */

/** A plan document with the given scope-path lines in its baseline. */
function planWithScope(scopePaths: string[]): string {
  return renderPlan({ id: "attendance-punch-sync", method: "bug-fix" }, "2026-08-13", {
    commit: "a1b2c3d",
    branch: "main",
    dirty: "no",
    source: "none",
    ownership: "mixed",
    scopePaths,
  });
}

describe("isValidScopePath", () => {
  it("accepts exact repository-relative file paths", () => {
    expect(isValidScopePath("src/engine/report.ts")).toBe(true);
    expect(isValidScopePath("AGENTS.md")).toBe(true);
    expect(isValidScopePath("src/PunchService.php")).toBe(true);
    expect(isValidScopePath("tests/attendance/PunchService.test.ts")).toBe(true);
    expect(isValidScopePath("docs/a file with spaces.md")).toBe(true);
  });

  it("accepts directory-prefix scopes with a trailing slash", () => {
    expect(isValidScopePath("src/attendance/")).toBe(true);
    expect(isValidScopePath("tests/")).toBe(true);
    expect(isValidScopePath("src/")).toBe(true);
    expect(isDirectoryScope("src/attendance/")).toBe(true);
  });

  it("treats a path without a trailing slash as an exact path, not a subtree", () => {
    expect(isValidScopePath("src/attendance")).toBe(true);
    expect(isDirectoryScope("src/attendance")).toBe(false);
  });

  it("rejects absolute paths", () => {
    expect(scopePathError("/etc/passwd")).toMatch(/relative to the repository root/);
    expect(scopePathError("/")).toMatch(/relative to the repository root/);
    expect(isValidScopePath("/src/x.ts")).toBe(false);
  });

  it("rejects traversal out of the repository", () => {
    for (const bad of ["../x.ts", "a/../../b", "..", "../../"]) {
      expect(scopePathError(bad)).toMatch(/must not traverse outside the repository/);
      expect(isValidScopePath(bad)).toBe(false);
    }
  });

  it("rejects glob syntax", () => {
    for (const bad of [
      "src/**/*.ts",
      "*.ts",
      "src/*",
      "tests/**",
      "src/attendance/[ab].ts",
      "src/{a,b}.ts",
      "src/attendance/Punch?ervice.ts",
    ]) {
      expect(scopePathError(bad)).toMatch(/must not contain glob characters/);
      expect(isValidScopePath(bad)).toBe(false);
    }
  });

  it("rejects malformed declarations", () => {
    expect(scopePathError("")).toMatch(/must not be empty/);
    expect(scopePathError(".")).toContain("must not be '.'");
    expect(scopePathError("a\\b.ts")).toContain("must use forward slashes");
    expect(scopePathError("src//report.ts")).toMatch(/must not contain empty segments/);
    expect(scopePathError("src//")).toMatch(/must not contain empty segments/);
    expect(scopePathError(":(glob)src/*.ts")).toMatch(/must not use git pathspec magic/);
    for (const bad of ["", ".", "a\\b.ts", "src//report.ts", "src//", ":(top)src"]) {
      expect(isValidScopePath(bad)).toBe(false);
    }
  });
});

describe("scopeFromBaseline", () => {
  it("extracts multiple validated scope paths in declaration order", () => {
    const scope = scopeFromBaseline(
      planWithScope([
        "src/attendance/PunchService.php",
        "tests/attendance/",
        "docs/attendance/notes.md",
      ]),
    );
    expect(scope.declared).toBe(true);
    expect(scope.paths).toEqual([
      "src/attendance/PunchService.php",
      "tests/attendance/",
      "docs/attendance/notes.md",
    ]);
    expect(scope.invalid).toEqual([]);
  });

  it("separates invalid declarations from valid ones without guessing", () => {
    const scope = scopeFromBaseline(
      planWithScope(["src/attendance/", "/etc/passwd", "../escape.ts", "src/**/*.ts"]),
    );
    expect(scope.declared).toBe(true);
    expect(scope.paths).toEqual(["src/attendance/"]);
    expect(scope.invalid.map((entry) => entry.value)).toEqual([
      "/etc/passwd",
      "../escape.ts",
      "src/**/*.ts",
    ]);
    for (const entry of scope.invalid) {
      expect(entry.reason.length).toBeGreaterThan(0);
    }
  });

  it("is deterministic for the same document", () => {
    const content = planWithScope(["src/attendance/", "/etc/passwd", "tests/attendance/"]);
    expect(scopeFromBaseline(content)).toEqual(scopeFromBaseline(content));
  });

  it("reports a baseline without scope-path lines as undeclared", () => {
    const scope = scopeFromBaseline(
      renderPlan({ id: "x", method: "bug-fix" }, "2026-08-13", {
        commit: "a1b2c3d",
        branch: "main",
        dirty: "no",
        source: "none",
        ownership: "mixed",
      }),
    );
    expect(scope).toEqual({ declared: false, paths: [], invalid: [] });
  });
});

describe("scope + baseline integration", () => {
  it("round-trips scope-path lines through render and parse", () => {
    const fields: BaselineFields = {
      commit: "a1b2c3d",
      branch: "main",
      dirty: "no",
      source: "none",
      ownership: "mixed",
      scopePaths: ["src/attendance/", "tests/attendance/PunchService.test.ts"],
    };
    const doc = ["# Plan", "", renderBaseline(fields), "", "## Objective", ""].join("\n");
    const parsed = parseBaseline(doc);
    expect(parsed).toEqual({
      present: true,
      valid: true,
      fields: {
        ...fields,
        scopePaths: ["src/attendance/", "tests/attendance/PunchService.test.ts"],
      },
    });
    expect(scopeFromBaseline(doc).paths).toEqual([
      "src/attendance/",
      "tests/attendance/PunchService.test.ts",
    ]);
  });

  it("rendering scope lines never expands the frozen plan metadata parse", () => {
    const content = planWithScope(["src/attendance/", "src/billing/"]);
    // The frozen four-field parse is byte-preserving and blind to scope.
    const plan = parsePlan(content);
    expect(plan).toMatchObject({
      id: "attendance-punch-sync",
      method: "bug-fix",
      status: "PLANNED",
    });
    expect(parsePlan(content).content).toBe(content);
    // Scope sits under ## Baseline, never under ## Metadata.
    const baseline = content.indexOf("## Baseline");
    expect(content.indexOf("## Metadata")).toBeLessThan(baseline);
    expect(content.indexOf("- scope-path: src/attendance/")).toBeGreaterThan(baseline);
  });

  it("keeps the engine-rendered template scope-free and byte-identical", () => {
    const without = renderPlan({ id: "x", method: "bug-fix" }, "2026-08-13");
    expect(without).not.toContain("scope-path");
    expect(without).toBe(renderPlan({ id: "x", method: "bug-fix" }, "2026-08-13"));
  });
});

describe("backward compatibility", () => {
  it("treats v2 plans without a baseline as unscoped", () => {
    // A v2-created plan: no ## Baseline section at all.
    const v2Content = renderPlan({ id: "legacy", method: "bug-fix" }, "2026-08-13");
    expect(v2Content).not.toContain("## Baseline");
    const scope = scopeFromBaseline(v2Content);
    expect(scope).toEqual({ declared: false, paths: [], invalid: [] });
    // And it still parses under the frozen v2 contract.
    expect(parsePlan(v2Content).id).toBe("legacy");
  });

  it("treats a baseline plan without scope lines as unscoped", () => {
    const content = planWithScope([]);
    expect(scopeFromBaseline(content)).toEqual({ declared: false, paths: [], invalid: [] });
  });

  it("reports an absent baseline as unscoped rather than invalid", () => {
    expect(scopeFromBaseline("# Session\n\n- Commit: abc\n")).toEqual({
      declared: false,
      paths: [],
      invalid: [],
    });
  });
});
