import { describe, expect, it } from "vitest";
import { parseBaseline, renderBaseline, type BaselineFields } from "./baseline.js";

const FIELDS: BaselineFields = {
  commit: "a1b2c3d",
  branch: "main",
  dirty: "no",
  source: "none",
  ownership: "mixed",
  scopePaths: [],
};

describe("renderBaseline", () => {
  it("renders required fields in contract order", () => {
    expect(renderBaseline(FIELDS)).toBe(
      [
        "## Baseline",
        "",
        "- commit: a1b2c3d",
        "- branch: main",
        "- dirty: no",
        "- source: none",
        "- ownership: mixed",
      ].join("\n"),
    );
  });

  it("renders scope paths after the scalar fields", () => {
    const rendered = renderBaseline({
      ...FIELDS,
      scopePaths: ["src/attendance/", "tests/attendance/PunchService.test.ts"],
    });
    expect(rendered).toContain("- scope-path: src/attendance/");
    expect(rendered.indexOf("- scope-path: src/attendance/")).toBeLessThan(
      rendered.indexOf("- scope-path: tests/attendance/PunchService.test.ts"),
    );
  });

  it("omits optional fields when empty", () => {
    const rendered = renderBaseline({ commit: "a1b2c3d", branch: "main", dirty: "yes" });
    expect(rendered).toBe(
      ["## Baseline", "", "- commit: a1b2c3d", "- branch: main", "- dirty: yes"].join("\n"),
    );
    expect(rendered).not.toContain("- source:");
    expect(rendered).not.toContain("- ownership:");
    expect(rendered).not.toContain("- scope-path:");
  });
});

describe("parseBaseline", () => {
  it("round-trips a rendered baseline embedded in a larger document", () => {
    const doc = [
      "# A Plan",
      "",
      "## Metadata",
      "",
      "- id: x",
      "",
      renderBaseline(FIELDS),
      "",
      "## Objective",
      "",
    ].join("\n");
    expect(parseBaseline(doc)).toEqual({ present: true, valid: true, fields: FIELDS });
  });

  it("locates the section by grammar wherever it appears", () => {
    const doc = [
      "# Current Objective",
      "go",
      "",
      "## Baseline",
      "",
      "- commit: c1",
      "- branch: main",
      "- dirty: no",
      "",
    ].join("\n");
    expect(parseBaseline(doc)).toEqual({
      present: true,
      valid: true,
      fields: {
        commit: "c1",
        branch: "main",
        dirty: "no",
        source: "",
        ownership: "",
        scopePaths: [],
      },
    });
  });

  it("returns absent for documents without the section", () => {
    expect(parseBaseline("# Session\n\n- Commit: abc\n")).toEqual({ present: false });
    expect(parseBaseline("")).toEqual({ present: false });
  });

  it("normalizes CRLF line endings", () => {
    const doc = "## Baseline\r\n\r\n- commit: c1\r\n- branch: main\r\n- dirty: yes\r\n";
    expect(parseBaseline(doc)).toEqual({
      present: true,
      valid: true,
      fields: {
        commit: "c1",
        branch: "main",
        dirty: "yes",
        source: "",
        ownership: "",
        scopePaths: [],
      },
    });
  });

  it("collects repeated scope-path lines in order", () => {
    const doc = [
      "## Baseline",
      "",
      "- commit: c1",
      "- branch: main",
      "- dirty: no",
      "- scope-path: a/",
      "- scope-path: b.ts",
      "",
    ].join("\n");
    const parsed = parseBaseline(doc);
    expect(parsed).toMatchObject({ present: true, valid: true });
    if (parsed.present && parsed.valid) {
      expect(parsed.fields.scopePaths).toEqual(["a/", "b.ts"]);
    }
  });

  it("rejects a section missing a required field", () => {
    const doc = ["## Baseline", "", "- commit: c1", "- dirty: no", ""].join("\n");
    expect(parseBaseline(doc)).toEqual({
      present: true,
      valid: false,
      reason: "baseline is missing required field: branch",
    });
  });

  it("rejects an empty required field", () => {
    const doc = ["## Baseline", "", "- commit:", "- branch: main", "- dirty: no", ""].join("\n");
    expect(parseBaseline(doc)).toMatchObject({ present: true, valid: false });
  });

  it("rejects duplicate required fields", () => {
    const doc = [
      "## Baseline",
      "",
      "- commit: c1",
      "- commit: c2",
      "- branch: main",
      "- dirty: no",
      "",
    ].join("\n");
    expect(parseBaseline(doc)).toEqual({
      present: true,
      valid: false,
      reason: "duplicate baseline field: commit",
    });
  });

  it("rejects an invalid dirty value", () => {
    const doc = ["## Baseline", "", "- commit: c1", "- branch: main", "- dirty: maybe", ""].join(
      "\n",
    );
    expect(parseBaseline(doc)).toEqual({
      present: true,
      valid: false,
      reason: "invalid baseline dirty value: maybe; expected yes or no",
    });
  });

  it("ignores content that is not a bullet field inside the section", () => {
    const doc = [
      "## Baseline",
      "",
      "- commit: c1",
      "- branch: main",
      "- dirty: no",
      "free text",
      "- scope-path: x/",
      "",
    ].join("\n");
    const parsed = parseBaseline(doc);
    expect(parsed).toMatchObject({ present: true, valid: true });
    if (parsed.present && parsed.valid) {
      expect(parsed.fields.scopePaths).toEqual(["x/"]);
    }
  });

  it("stops the section at the next heading", () => {
    const doc = [
      "## Baseline",
      "",
      "- commit: c1",
      "- branch: main",
      "- dirty: no",
      "## Objective",
      "- scope-path: nope/",
    ].join("\n");
    const parsed = parseBaseline(doc);
    expect(parsed).toMatchObject({ present: true, valid: true });
    if (parsed.present && parsed.valid) {
      expect(parsed.fields.scopePaths).toEqual([]);
    }
  });
});
