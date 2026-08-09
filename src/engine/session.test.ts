import { describe, expect, it } from "vitest";
import {
  capField,
  extractPreviousContext,
  formatSessionId,
  MAX_CONTEXT_FIELD_CHARS,
  parseSessionSections,
  resolveContextFields,
  resolveDestinationTemplate,
  toLocalIso,
} from "./session.js";

describe("parseSessionSections", () => {
  it("parses every section of a session summary", () => {
    const content = [
      "# Session",
      "",
      "## Objective",
      "Ship the widget.",
      "",
      "## Summary",
      "Built the widget.",
      "",
      "## Decisions",
      "- Use TypeScript.",
      "",
      "## Files Changed",
      "- src/main.ts",
      "",
      "## Next Steps",
      "Review the PR.",
      "",
      "## Open Questions",
      "Who owns the widget?",
    ].join("\n");
    expect(parseSessionSections(content)).toEqual({
      objective: "Ship the widget.",
      summary: "Built the widget.",
      decisions: "- Use TypeScript.",
      filesChanged: "- src/main.ts",
      nextSteps: "Review the PR.",
      openQuestions: "Who owns the widget?",
    });
  });

  it("returns empty strings for missing sections", () => {
    expect(parseSessionSections("## Summary\nonly this\n")).toEqual({
      objective: "",
      summary: "only this",
      decisions: "",
      filesChanged: "",
      nextSteps: "",
      openQuestions: "",
    });
  });

  it("normalizes CRLF line endings", () => {
    expect(parseSessionSections("## Objective\r\nGoal\r\n").objective).toBe("Goal");
  });
});

describe("extractPreviousContext", () => {
  it("extracts the objective and open questions from a current context", () => {
    const context = [
      "# Current Objective",
      "Ship the widget.",
      "",
      "# Current State",
      "Halfway.",
      "",
      "# Open Questions",
      "Who owns it?",
    ].join("\n");
    expect(extractPreviousContext(context)).toEqual({
      objective: "Ship the widget.",
      openQuestions: "Who owns it?",
    });
  });

  it("returns empty strings when the context is empty", () => {
    expect(extractPreviousContext("")).toEqual({ objective: "", openQuestions: "" });
  });
});

describe("resolveContextFields", () => {
  const previous = { objective: "old goal", openQuestions: "old question" };

  it("carries forward the previous objective and open questions when absent", () => {
    const resolved = resolveContextFields(
      {
        objective: "",
        summary: "s",
        decisions: "",
        filesChanged: "",
        nextSteps: "",
        openQuestions: "",
      },
      previous,
    );
    expect(resolved.objective).toBe("old goal");
    expect(resolved.openQuestions).toBe("old question");
  });

  it("keeps the session values when present", () => {
    const resolved = resolveContextFields(
      {
        objective: "new goal",
        summary: "s",
        decisions: "",
        filesChanged: "",
        nextSteps: "",
        openQuestions: "new question",
      },
      previous,
    );
    expect(resolved.objective).toBe("new goal");
    expect(resolved.openQuestions).toBe("new question");
  });
});

describe("capField", () => {
  it("leaves short fields unchanged", () => {
    expect(capField("short")).toBe("short");
  });

  it("truncates long fields to the one-page cap", () => {
    const long = "x".repeat(MAX_CONTEXT_FIELD_CHARS + 10);
    const capped = capField(long);
    expect(capped.length).toBe(MAX_CONTEXT_FIELD_CHARS + 1);
    expect(capped.endsWith("…")).toBe(true);
    expect(capped.slice(0, MAX_CONTEXT_FIELD_CHARS)).toBe("x".repeat(MAX_CONTEXT_FIELD_CHARS));
  });
});

describe("formatSessionId", () => {
  it("formats a date as YYYY-MM-DD_HHMMSS", () => {
    expect(formatSessionId(new Date(2026, 7, 9, 9, 30, 5))).toBe("2026-08-09_093005");
  });

  it("zero-pads month, day and time", () => {
    expect(formatSessionId(new Date(2026, 0, 3, 4, 5, 6))).toBe("2026-01-03_040506");
  });
});

describe("toLocalIso", () => {
  it("produces a local ISO timestamp with offset", () => {
    const date = new Date(2026, 7, 9, 9, 30, 5);
    const iso = toLocalIso(date);
    expect(iso.startsWith("2026-08-09T09:30:05")).toBe(true);
    expect(iso).toMatch(/^2026-08-09T09:30:05[+-]\d{2}:\d{2}$/);
  });
});

describe("resolveDestinationTemplate", () => {
  it("substitutes string variables into a destination", () => {
    const variables = { session: { id: "2026-08-09_093000" } };
    expect(resolveDestinationTemplate(".ai/sessions/{{session.id}}.md", variables)).toBe(
      ".ai/sessions/2026-08-09_093000.md",
    );
  });

  it("resolves missing variables to an empty string", () => {
    expect(resolveDestinationTemplate("a{{missing}}b", {})).toBe("ab");
  });

  it("leaves destinations without references unchanged", () => {
    expect(resolveDestinationTemplate("AGENTS.md", {})).toBe("AGENTS.md");
  });
});
