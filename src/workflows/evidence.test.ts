import { describe, expect, it } from "vitest";
import { EVIDENCE_CATEGORIES, isEvidenceCategory, parseEvidenceRequirements } from "./evidence.js";

/** A minimal workflow document with the given Required Evidence body. */
const workflowWithEvidence = (body: string): string =>
  ["# Bug-Fix", "", "## Metadata", "", "- id: bug-fix", "", "## Required Evidence", body].join(
    "\n",
  );

describe("EVIDENCE_CATEGORIES", () => {
  it("is the closed vocabulary from WORKFLOW-SPEC v1.1.0, sorted", () => {
    expect([...EVIDENCE_CATEGORIES]).toEqual([
      "acceptance-criteria",
      "commit",
      "git-state",
      "release",
      "tests",
      "verification",
    ]);
  });

  it("recognizes exactly the canonical categories", () => {
    expect(isEvidenceCategory("tests")).toBe(true);
    expect(isEvidenceCategory("acceptance-criteria")).toBe(true);
    expect(isEvidenceCategory("Tests")).toBe(false);
    expect(isEvidenceCategory("tsets")).toBe(false);
    expect(isEvidenceCategory("changelog")).toBe(false);
    expect(isEvidenceCategory("")).toBe(false);
  });
});

describe("parseEvidenceRequirements", () => {
  it("parses canonical checklist items as requirements", () => {
    const parsed = parseEvidenceRequirements(
      workflowWithEvidence("\n- [ ] tests\n- [ ] verification\n- [ ] commit\n"),
    );
    expect(parsed.requirements).toEqual(["tests", "verification", "commit"]);
    expect(parsed.manual).toEqual([]);
    expect(parsed.invalid).toEqual([]);
  });

  it("treats the checkbox state as not meaningful", () => {
    const parsed = parseEvidenceRequirements(workflowWithEvidence("\n- [x] tests\n- [X] commit\n"));
    expect(parsed.requirements).toEqual(["tests", "commit"]);
    expect(parsed.invalid).toEqual([]);
  });

  it("collapses duplicate declarations — requirements are a set", () => {
    const parsed = parseEvidenceRequirements(workflowWithEvidence("\n- [ ] tests\n- [ ] tests\n"));
    expect(parsed.requirements).toEqual(["tests"]);
  });

  it("keeps first-declaration order for requirements", () => {
    const parsed = parseEvidenceRequirements(
      workflowWithEvidence("\n- [ ] commit\n- [ ] tests\n- [ ] verification\n"),
    );
    expect(parsed.requirements).toEqual(["commit", "tests", "verification"]);
  });

  it("reports unknown checklist items as invalid without guessing", () => {
    const parsed = parseEvidenceRequirements(
      workflowWithEvidence("\n- [ ] tests\n- [ ] tsets\n- [ ] changelog\n"),
    );
    expect(parsed.requirements).toEqual(["tests"]);
    expect(parsed.invalid).toEqual(["tsets", "changelog"]);
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
    expect(parsed.requirements).toEqual(["tests"]);
    expect(parsed.invalid).toEqual([]);
  });

  it("reports plain bullets as manual human requirements", () => {
    const parsed = parseEvidenceRequirements(
      workflowWithEvidence("\n- [ ] tests\n- Reproduction (when reproducible)\n- Root cause\n"),
    );
    expect(parsed.requirements).toEqual(["tests"]);
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
    expect(parsed.requirements).toEqual(["tests"]);
    expect(parsed.invalid).toEqual([]);
    expect(parsed.manual).toEqual([]);
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
    expect(parsed.requirements).toEqual(["tests"]);
    expect(parsed.manual).toEqual(["Manual note"]);
  });
});
