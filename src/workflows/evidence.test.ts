import { describe, expect, it } from "vitest";
import {
  EVIDENCE_CATEGORIES,
  isEvidenceCategory,
  isPathBoundCategory,
  isSafeRelativePath,
  parseEvidenceRequirements,
} from "./evidence.js";

/** A minimal workflow document with the given Required Evidence body. */
const workflowWithEvidence = (body: string): string =>
  ["# Bug-Fix", "", "## Metadata", "", "- id: bug-fix", "", "## Required Evidence", body].join(
    "\n",
  );

describe("EVIDENCE_CATEGORIES", () => {
  it("is the closed vocabulary from WORKFLOW-SPEC, sorted", () => {
    expect([...EVIDENCE_CATEGORIES]).toEqual([
      "acceptance-criteria",
      "changelog",
      "commit",
      "git-state",
      "release",
      "tests",
      "verification",
      "version",
    ]);
  });

  it("recognizes exactly the canonical categories", () => {
    expect(isEvidenceCategory("tests")).toBe(true);
    expect(isEvidenceCategory("acceptance-criteria")).toBe(true);
    expect(isEvidenceCategory("changelog")).toBe(true);
    expect(isEvidenceCategory("version")).toBe(true);
    expect(isEvidenceCategory("Tests")).toBe(false);
    expect(isEvidenceCategory("tsets")).toBe(false);
    expect(isEvidenceCategory("release-notes")).toBe(false);
    expect(isEvidenceCategory("")).toBe(false);
  });

  it("marks exactly the path-bound categories", () => {
    expect(isPathBoundCategory("changelog")).toBe(true);
    expect(isPathBoundCategory("version")).toBe(true);
    expect(isPathBoundCategory("tests")).toBe(false);
    expect(isPathBoundCategory("release")).toBe(false);
  });
});

describe("isSafeRelativePath", () => {
  it("accepts plain repository-relative paths", () => {
    expect(isSafeRelativePath("CHANGELOG.md")).toBe(true);
    expect(isSafeRelativePath("app/composer.json")).toBe(true);
    expect(isSafeRelativePath("docs/deep/version.properties")).toBe(true);
  });

  it("rejects absolute, traversal and Windows forms", () => {
    expect(isSafeRelativePath("")).toBe(false);
    expect(isSafeRelativePath(".")).toBe(false);
    expect(isSafeRelativePath("/etc/passwd")).toBe(false);
    expect(isSafeRelativePath("../escape.md")).toBe(false);
    expect(isSafeRelativePath("a/../../b")).toBe(false);
    expect(isSafeRelativePath("a\\b.md")).toBe(false);
  });
});

describe("parseEvidenceRequirements", () => {
  it("parses canonical checklist items as requirements", () => {
    const parsed = parseEvidenceRequirements(
      workflowWithEvidence("\n- [ ] tests\n- [ ] verification\n- [ ] commit\n"),
    );
    expect(parsed.requirements).toEqual([
      { category: "tests" },
      { category: "verification" },
      { category: "commit" },
    ]);
    expect(parsed.manual).toEqual([]);
    expect(parsed.invalid).toEqual([]);
  });

  it("treats the checkbox state as not meaningful", () => {
    const parsed = parseEvidenceRequirements(workflowWithEvidence("\n- [x] tests\n- [X] commit\n"));
    expect(parsed.requirements).toEqual([{ category: "tests" }, { category: "commit" }]);
    expect(parsed.invalid).toEqual([]);
  });

  it("collapses duplicate declarations — requirements are a set", () => {
    const parsed = parseEvidenceRequirements(workflowWithEvidence("\n- [ ] tests\n- [ ] tests\n"));
    expect(parsed.requirements).toEqual([{ category: "tests" }]);
  });

  it("keeps first-declaration order for requirements", () => {
    const parsed = parseEvidenceRequirements(
      workflowWithEvidence("\n- [ ] commit\n- [ ] tests\n- [ ] verification\n"),
    );
    expect(parsed.requirements).toEqual([
      { category: "commit" },
      { category: "tests" },
      { category: "verification" },
    ]);
  });

  it("reports unknown checklist items as invalid without guessing", () => {
    const parsed = parseEvidenceRequirements(
      workflowWithEvidence("\n- [ ] tests\n- [ ] tsets\n- [ ] release-notes\n"),
    );
    expect(parsed.requirements).toEqual([{ category: "tests" }]);
    expect(parsed.invalid).toEqual(["tsets", "release-notes"]);
  });

  it("rejects non-lowercase category names (exact match rule)", () => {
    const parsed = parseEvidenceRequirements(workflowWithEvidence("\n- [ ] Tests\n"));
    expect(parsed.requirements).toEqual([]);
    expect(parsed.invalid).toEqual(["Tests"]);
  });

  it("ignores empty checklist items — they declare nothing", () => {
    const parsed = parseEvidenceRequirements(
      workflowWithEvidence("\n- [ ]\n- [ ]   \n- [ ] tests\n"),
    );
    expect(parsed.requirements).toEqual([{ category: "tests" }]);
    expect(parsed.invalid).toEqual([]);
  });

  it("reports plain bullets as manual human requirements", () => {
    const parsed = parseEvidenceRequirements(
      workflowWithEvidence("\n- [ ] tests\n- Reproduction (when reproducible)\n- Root cause\n"),
    );
    expect(parsed.requirements).toEqual([{ category: "tests" }]);
    expect(parsed.manual).toEqual(["Reproduction (when reproducible)", "Root cause"]);
    expect(parsed.invalid).toEqual([]);
  });

  it("deduplicates identical manual bullets", () => {
    const parsed = parseEvidenceRequirements(
      workflowWithEvidence("\n- Root cause\n- Root cause\n"),
    );
    expect(parsed.manual).toEqual(["Root cause"]);
  });

  it("ignores prose paragraphs and stops at the next section", () => {
    const content = [
      "# Bug-Fix",
      "",
      "## Required Evidence",
      "",
      "- [ ] tests",
      "",
      "Some prose paragraph that is not a bullet.",
      "",
      "## Completion Criteria",
      "",
      "- [ ] acceptance-criteria-met-not-a-declaration",
    ].join("\n");
    const parsed = parseEvidenceRequirements(content);
    expect(parsed.requirements).toEqual([{ category: "tests" }]);
    expect(parsed.invalid).toEqual([]);
    expect(parsed.manual).toEqual([]);
  });

  it("parses path-bound categories with a repository-relative path", () => {
    const parsed = parseEvidenceRequirements(
      workflowWithEvidence("\n- [ ] changelog: CHANGELOG.md\n- [ ] version: package.json\n"),
    );
    expect(parsed.requirements).toEqual([
      { category: "changelog", path: "CHANGELOG.md" },
      { category: "version", path: "package.json" },
    ]);
    expect(parsed.invalid).toEqual([]);
  });

  it("rejects the bare form of a path-bound category", () => {
    const parsed = parseEvidenceRequirements(workflowWithEvidence("\n- [ ] changelog\n"));
    expect(parsed.requirements).toEqual([]);
    expect(parsed.invalid).toEqual(["changelog"]);
  });

  it("rejects a path on a path-free category", () => {
    const parsed = parseEvidenceRequirements(workflowWithEvidence("\n- [ ] tests: x.md\n"));
    expect(parsed.requirements).toEqual([]);
    expect(parsed.invalid).toEqual(["tests: x.md"]);
  });

  it("rejects unsafe paths as invalid requirements", () => {
    const parsed = parseEvidenceRequirements(
      workflowWithEvidence(
        "\n- [ ] changelog: ../escape.md\n- [ ] version: /etc/passwd\n- [ ] changelog: a\\b.md\n- [ ] version:\n",
      ),
    );
    expect(parsed.requirements).toEqual([]);
    expect(parsed.invalid).toEqual([
      "changelog: ../escape.md",
      "version: /etc/passwd",
      "changelog: a\\b.md",
      "version:",
    ]);
  });

  it("keeps distinct paths for the same path-bound category", () => {
    const parsed = parseEvidenceRequirements(
      workflowWithEvidence("\n- [ ] version: package.json\n- [ ] version: app/composer.json\n"),
    );
    expect(parsed.requirements).toEqual([
      { category: "version", path: "package.json" },
      { category: "version", path: "app/composer.json" },
    ]);
  });

  it("returns no requirements when the section is missing or empty", () => {
    expect(parseEvidenceRequirements("# X\n\n## Metadata\n\n- id: x\n")).toEqual({
      requirements: [],
      manual: [],
      invalid: [],
    });
    expect(parseEvidenceRequirements(workflowWithEvidence(""))).toEqual({
      requirements: [],
      manual: [],
      invalid: [],
    });
  });

  it("normalizes CRLF line endings", () => {
    const parsed = parseEvidenceRequirements(
      workflowWithEvidence("\r\n- [ ] tests\r\n- Manual note\r\n"),
    );
    expect(parsed.requirements).toEqual([{ category: "tests" }]);
    expect(parsed.manual).toEqual(["Manual note"]);
  });
});
