import { describe, expect, it } from "vitest";
import {
  PLAN_ABANDONED,
  formatPlanDate,
  isPlanStatus,
  isValidPlanDate,
  isValidPlanId,
  parsePlan,
  planFilename,
  renderPlan,
  setPlanStatus,
  transitionPlan,
} from "./plan.js";

describe("isValidPlanId", () => {
  it("accepts kebab-case ids", () => {
    expect(isValidPlanId("attendance-punch-sync")).toBe(true);
    expect(isValidPlanId("a")).toBe(true);
    expect(isValidPlanId("plan-42")).toBe(true);
    expect(isValidPlanId("a-b-c")).toBe(true);
  });

  it("rejects ids that would be unsafe as file names", () => {
    expect(isValidPlanId("../escape")).toBe(false);
    expect(isValidPlanId("a/b")).toBe(false);
    expect(isValidPlanId("a\\b")).toBe(false);
    expect(isValidPlanId("..")).toBe(false);
    expect(isValidPlanId(".")).toBe(false);
    expect(isValidPlanId("")).toBe(false);
    expect(isValidPlanId("-a")).toBe(false);
    expect(isValidPlanId("a-")).toBe(false);
    expect(isValidPlanId("a--b")).toBe(false);
    expect(isValidPlanId("a b")).toBe(false);
    expect(isValidPlanId("Capital")).toBe(false);
    expect(isValidPlanId("a_b")).toBe(false);
  });
});

describe("isValidPlanDate", () => {
  it("accepts real calendar dates", () => {
    expect(isValidPlanDate("2026-08-13")).toBe(true);
    expect(isValidPlanDate("2024-02-29")).toBe(true);
    expect(isValidPlanDate("2000-01-01")).toBe(true);
  });

  it("rejects malformed and impossible dates", () => {
    expect(isValidPlanDate("2026/08/13")).toBe(false);
    expect(isValidPlanDate("2026-8-13")).toBe(false);
    expect(isValidPlanDate("08-13-2026")).toBe(false);
    expect(isValidPlanDate("2026-13-01")).toBe(false);
    expect(isValidPlanDate("2026-02-30")).toBe(false);
    expect(isValidPlanDate("2023-02-29")).toBe(false);
    expect(isValidPlanDate("2026-00-10")).toBe(false);
    expect(isValidPlanDate("not-a-date")).toBe(false);
    expect(isValidPlanDate("")).toBe(false);
  });
});

describe("formatPlanDate", () => {
  it("formats a date as local YYYY-MM-DD with zero padding", () => {
    expect(formatPlanDate(new Date(2026, 7, 13, 10, 30, 45))).toBe("2026-08-13");
    expect(formatPlanDate(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("planFilename", () => {
  it("joins created date and id with a trailing .md", () => {
    expect(planFilename("2026-08-13", "attendance-punch-sync")).toBe(
      "2026-08-13-attendance-punch-sync.md",
    );
  });
});

describe("isPlanStatus", () => {
  it("recognizes the lifecycle states and ABANDONED", () => {
    expect(isPlanStatus("PLANNED")).toBe(true);
    expect(isPlanStatus("COMPLETED")).toBe(true);
    expect(isPlanStatus("ABANDONED")).toBe(true);
  });

  it("rejects unknown statuses", () => {
    expect(isPlanStatus("planned")).toBe(false);
    expect(isPlanStatus("DONE")).toBe(false);
    expect(isPlanStatus("EXECUTING_2")).toBe(false);
    expect(isPlanStatus("")).toBe(false);
  });
});

describe("parsePlan", () => {
  const CANONICAL = renderPlan({ id: "attendance-punch-sync", method: "bug-fix" }, "2026-08-13");

  it("parses the canonical template", () => {
    const plan = parsePlan(CANONICAL);
    expect(plan.id).toBe("attendance-punch-sync");
    expect(plan.method).toBe("bug-fix");
    expect(plan.status).toBe("PLANNED");
    expect(plan.created).toBe("2026-08-13");
    expect(plan.content).toBe(CANONICAL);
  });

  it("preserves body content verbatim", () => {
    const content = [
      "# My Plan",
      "",
      "## Metadata",
      "",
      "- id: my-plan",
      "- method: investigation",
      "- status: EXECUTING",
      "- created: 2026-01-05",
      "",
      "## Objective",
      "",
      "Investigate the flaky login test.",
      "",
      "## Notes",
      "",
      "- id: not-metadata",
      "- keep: this",
      "",
    ].join("\n");
    const plan = parsePlan(content);
    expect(plan.content).toBe(content);
    expect(plan.status).toBe("EXECUTING");
  });

  it("accepts ABANDONED as a recognized terminal status", () => {
    const plan = parsePlan(
      renderPlan(
        { id: "dropped", method: "investigation", title: "Dropped" },
        "2026-01-05",
      ).replace("- status: PLANNED", `- status: ${PLAN_ABANDONED}`),
    );
    expect(plan.status).toBe("ABANDONED");
  });

  it("normalizes CRLF to LF but keeps fields identical", () => {
    const plan = parsePlan(CANONICAL.replace(/\n/g, "\r\n"));
    expect(plan.id).toBe("attendance-punch-sync");
    expect(plan.status).toBe("PLANNED");
    expect(plan.created).toBe("2026-08-13");
    expect(plan.content).toBe(CANONICAL);
  });

  it("rejects a document without an H1 title", () => {
    const content =
      "## Metadata\n\n- id: x\n- method: bug-fix\n- status: PLANNED\n- created: 2026-08-13\n";
    expect(() => parsePlan(content)).toThrow(/missing an H1 title/);
  });

  it("rejects a document without a Metadata section", () => {
    const content = "# X\n\nsome body\n";
    expect(() => parsePlan(content)).toThrow(/missing a ## Metadata section/);
  });

  it.each(["id", "method", "status", "created"] as const)("rejects a missing %s field", (field) => {
    const line = (() => {
      switch (field) {
        case "id":
          return "- id: my-plan";
        case "method":
          return "- method: bug-fix";
        case "status":
          return "- status: PLANNED";
        case "created":
          return "- created: 2026-08-13";
      }
    })();
    const content = [
      "# My Plan",
      "",
      "## Metadata",
      "",
      ...[
        "- id: my-plan",
        "- method: bug-fix",
        "- status: PLANNED",
        "- created: 2026-08-13",
      ].filter((l) => l !== line),
      "",
      "## Objective",
      "",
    ].join("\n");
    expect(() => parsePlan(content)).toThrow(new RegExp(`missing metadata field: ${field}`));
  });

  it("rejects an empty metadata value", () => {
    const content = [
      "# My Plan",
      "",
      "## Metadata",
      "",
      "- id: my-plan",
      "- method: ",
      "- status: PLANNED",
      "- created: 2026-08-13",
      "",
    ].join("\n");
    expect(() => parsePlan(content)).toThrow(/missing metadata field: method/);
  });

  it("rejects duplicate metadata fields", () => {
    const content = [
      "# My Plan",
      "",
      "## Metadata",
      "",
      "- id: my-plan",
      "- method: bug-fix",
      "- status: PLANNED",
      "- created: 2026-08-13",
      "- id: another",
      "",
    ].join("\n");
    expect(() => parsePlan(content)).toThrow(/duplicate metadata field: id/);
  });

  it("rejects an invalid plan id", () => {
    const content = renderPlan({ id: "my-plan", method: "bug-fix" }, "2026-08-13").replace(
      "- id: my-plan",
      "- id: ../escape",
    );
    expect(() => parsePlan(content)).toThrow(/invalid plan id/);
  });

  it("rejects an unknown status", () => {
    const content = renderPlan({ id: "my-plan", method: "bug-fix" }, "2026-08-13").replace(
      "- status: PLANNED",
      "- status: DONE",
    );
    expect(() => parsePlan(content)).toThrow(/unknown plan status: DONE/);
  });

  it("rejects a lowercase status", () => {
    const content = renderPlan({ id: "my-plan", method: "bug-fix" }, "2026-08-13").replace(
      "- status: PLANNED",
      "- status: planned",
    );
    expect(() => parsePlan(content)).toThrow(/unknown plan status/);
  });

  it("rejects an invalid created date", () => {
    const content = renderPlan({ id: "my-plan", method: "bug-fix" }, "2026-08-13").replace(
      "- created: 2026-08-13",
      "- created: 2026-02-30",
    );
    expect(() => parsePlan(content)).toThrow(/invalid created date/);
  });
});

describe("renderPlan", () => {
  it("is deterministic for identical input", () => {
    const input = { id: "attendance-punch-sync", method: "bug-fix" };
    expect(renderPlan(input, "2026-08-13")).toBe(renderPlan(input, "2026-08-13"));
  });

  it("renders the canonical metadata and template sections", () => {
    const content = renderPlan({ id: "my-plan", method: "investigation" }, "2026-01-05");
    expect(content).toContain("# My Plan");
    expect(content).toContain("## Metadata");
    expect(content).toContain("- id: my-plan");
    expect(content).toContain("- method: investigation");
    expect(content).toContain("- status: PLANNED");
    expect(content).toContain("- created: 2026-01-05");
    for (const section of [
      "## Objective",
      "## Context",
      "## Scope",
      "## Constraints",
      "## Acceptance Criteria",
      "## Plan",
      "## Verification",
      "## Test Evidence",
      "## Decisions",
      "## Known Limitations",
      "## Commit",
      "## Next Action",
    ]) {
      expect(content).toContain(section);
    }
  });

  it("uses an explicit title when provided", () => {
    expect(
      renderPlan({ id: "my-plan", method: "bug-fix", title: "Fix Login" }, "2026-08-13"),
    ).toContain("# Fix Login");
  });
});

describe("setPlanStatus", () => {
  it("replaces only the status line and preserves the rest", () => {
    const original = renderPlan({ id: "my-plan", method: "bug-fix" }, "2026-08-13");
    const updated = setPlanStatus(original, "EXECUTING");
    expect(updated).toContain("- status: EXECUTING");
    expect(updated.replace("- status: EXECUTING", "")).toBe(
      original.replace("- status: PLANNED", ""),
    );
    expect(updated).toBe(original.replace("- status: PLANNED", "- status: EXECUTING"));
  });

  it("does not touch status-looking text outside the Metadata section", () => {
    const content = [
      "# My Plan",
      "",
      "## Metadata",
      "",
      "- id: my-plan",
      "- method: bug-fix",
      "- status: PLANNED",
      "- created: 2026-08-13",
      "",
      "## Objective",
      "",
      "- status: keep-me",
      "",
    ].join("\n");
    const updated = setPlanStatus(content, "EXECUTING");
    expect(updated).toContain("- status: EXECUTING");
    expect(updated).toContain("- status: keep-me");
  });

  it("throws when the status field is absent", () => {
    const content = [
      "# My Plan",
      "",
      "## Metadata",
      "",
      "- id: my-plan",
      "- method: bug-fix",
      "- created: 2026-08-13",
      "",
    ].join("\n");
    expect(() => setPlanStatus(content, "EXECUTING")).toThrow(/missing metadata field: status/);
  });
});

describe("transitionPlan", () => {
  it("allows forward transitions including skips", () => {
    expect(transitionPlan("PLANNED", "EXECUTING")).toBe("EXECUTING");
    expect(transitionPlan("EXECUTING", "VERIFIED")).toBe("VERIFIED");
    expect(transitionPlan("PLANNED", "COMPLETED")).toBe("COMPLETED");
    expect(transitionPlan("MERGED", "COMPLETED")).toBe("COMPLETED");
  });

  it("treats a same-status transition as an idempotent no-op", () => {
    expect(transitionPlan("EXECUTING", "EXECUTING")).toBe("EXECUTING");
    expect(transitionPlan("COMPLETED", "COMPLETED")).toBe("COMPLETED");
  });

  it.each([
    ["EXECUTING", "PLANNED"],
    ["VERIFIED", "EXECUTING"],
    ["COMPLETED", "EXECUTING"],
    ["MERGED", "TESTED"],
    ["COMPLETED", "PLANNED"],
  ] as const)("rejects the backwards transition %s → %s", (from, to) => {
    expect(() => transitionPlan(from, to)).toThrow(/backwards plan transition/);
  });

  it("rejects unknown statuses", () => {
    expect(() => transitionPlan("DONE" as never, "EXECUTING")).toThrow(/unknown plan status/);
    expect(() => transitionPlan("PLANNED", "done" as never)).toThrow(/unknown plan status/);
    expect(() => transitionPlan("planned" as never, "EXECUTING")).toThrow(/unknown plan status/);
  });

  it("rejects transitions to or from ABANDONED", () => {
    expect(() => transitionPlan("PLANNED", "ABANDONED")).toThrow(/ABANDONED/);
    expect(() => transitionPlan("ABANDONED", "PLANNED")).toThrow(/ABANDONED/);
  });
});
