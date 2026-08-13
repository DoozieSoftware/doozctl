import { describe, expect, it } from "vitest";
import { DEFAULT_METHOD, listWorkflowMethodIds, resolveWorkflowMethod } from "./methods.js";

describe("workflow methods", () => {
  it("defines the five initial methods from WORKFLOW-SPEC.md", () => {
    expect(listWorkflowMethodIds()).toEqual([
      "bug-fix",
      "feature",
      "investigation",
      "standard",
      "triage",
    ]);
  });

  it("defines standard as the default method", () => {
    expect(DEFAULT_METHOD).toBe("standard");
  });

  it("resolves each method and reads its id from the asset Metadata", () => {
    for (const id of listWorkflowMethodIds()) {
      const method = resolveWorkflowMethod(id);
      expect(method.id).toBe(id);
      expect(method.content).toContain("## Metadata");
      expect(method.content).toContain(`- id: ${id}`);
    }
  });

  it("rejects an unknown method", () => {
    expect(() => resolveWorkflowMethod("nope")).toThrow(/workflow method not found: nope/);
  });

  it("rejects a missing workflow asset", () => {
    expect(() => resolveWorkflowMethod("standard", {})).toThrow(
      /workflow method not found: standard/,
    );
  });

  it("rejects a malformed asset with no Metadata section", () => {
    expect(() => resolveWorkflowMethod("x", { x: "not a method document" })).toThrow(
      /workflow method asset is malformed: x/,
    );
  });

  it("rejects a malformed asset whose declared id does not match", () => {
    const content = ["# X", "", "## Metadata", "", "- id: other", ""].join("\n");
    expect(() => resolveWorkflowMethod("x", { x: content })).toThrow(
      /workflow method asset is malformed: x/,
    );
  });

  it("rejects a malformed asset with an empty id", () => {
    const content = ["# X", "", "## Metadata", "", "- id:", ""].join("\n");
    expect(() => resolveWorkflowMethod("x", { x: content })).toThrow(
      /workflow method asset is malformed: x/,
    );
  });
});
