import { describe, expect, it } from "vitest";
import { isGenerated, merge, MergeError } from "./merge.js";

const BEGIN = "<!-- DOOZCTL:BEGIN:v1 section-name -->";
const END = "<!-- DOOZCTL:END:v1 section-name -->";
const GENERATED = "<!-- DOOZCTL:GENERATED:v1 -->";

describe("merge: overwrite", () => {
  it("replaces existing content completely", () => {
    expect(merge("overwrite", "old content", "new content")).toBe("new content");
  });

  it("replaces empty existing content", () => {
    expect(merge("overwrite", "", "new")).toBe("new");
  });

  it("does not parse markers", () => {
    const existing = `${BEGIN}\nx\n${END}`;
    expect(merge("overwrite", existing, "fresh")).toBe("fresh");
  });
});

describe("merge: append", () => {
  it("appends rendered content to existing content", () => {
    expect(merge("append", "a", "b")).toBe("ab");
  });

  it("never modifies existing content", () => {
    const existing = "kept\nexactly";
    expect(merge("append", existing, "\nadded")).toBe("kept\nexactly\nadded");
  });
});

describe("merge: replace-generated", () => {
  it("replaces when the file is engine-generated", () => {
    const existing = `${GENERATED}\nold body`;
    const rendered = `${GENERATED}\nnew body`;
    expect(merge("replace-generated", existing, rendered)).toBe(rendered);
  });

  it("fails for a user-created file without the generated marker", () => {
    expect(() => merge("replace-generated", "user content", "x")).toThrow(MergeError);
  });

  it("fails when the generated marker is on a version other than v1", () => {
    const existing = "<!-- DOOZCTL:GENERATED:v2 -->\nbody";
    expect(() => merge("replace-generated", existing, "x")).toThrow(MergeError);
  });

  it("detects generated files", () => {
    expect(isGenerated(`${GENERATED}\nbody`)).toBe(true);
    expect(isGenerated("plain")).toBe(false);
  });
});

describe("merge: managed-blocks", () => {
  const existing = [
    "# AGENTS",
    "",
    "User notes stay.",
    "",
    BEGIN,
    "old generated",
    END,
    "",
    "More user prose.",
  ].join("\n");

  const rendered = [
    "# AGENTS",
    "",
    "fresh boilerplate that will NOT touch outside content",
    "",
    BEGIN,
    "new generated",
    END,
    "",
    "footer",
  ].join("\n");

  it("replaces only content inside the block", () => {
    const result = merge("managed-blocks", existing, rendered);
    expect(result).toContain("new generated");
    expect(result).not.toContain("old generated");
    expect(result).toContain("User notes stay.");
    expect(result).toContain("More user prose.");
  });

  it("preserves everything outside the block byte-for-byte", () => {
    const result = merge("managed-blocks", existing, rendered);
    const outsideBefore = existing.split(BEGIN)[0] as string;
    expect(result.startsWith(outsideBefore)).toBe(true);
    const tail = existing.split(END)[1] as string;
    expect(result.endsWith(tail)).toBe(true);
  });

  it("is deterministic", () => {
    expect(merge("managed-blocks", existing, rendered)).toBe(
      merge("managed-blocks", existing, rendered),
    );
  });

  it("repeated merges on the produced output are idempotent (property-style)", () => {
    const once = merge("managed-blocks", existing, rendered);
    const twice = merge("managed-blocks", once, rendered);
    expect(twice).toBe(once);
  });

  it("handles multiple disjoint blocks independently", () => {
    const mk = (name: string) => `<!-- DOOZCTL:BEGIN:v1 ${name} -->`;
    const mkEnd = (name: string) => `<!-- DOOZCTL:END:v1 ${name} -->`;
    const ex = [
      "top",
      mk("a"),
      "old-a",
      mkEnd("a"),
      "mid",
      mk("b"),
      "old-b",
      mkEnd("b"),
      "bot",
    ].join("\n");
    const ren = [
      "top",
      mk("a"),
      "new-a",
      mkEnd("a"),
      "mid",
      mk("b"),
      "new-b",
      mkEnd("b"),
      "bot",
    ].join("\n");
    const out = merge("managed-blocks", ex, ren);
    expect(out).toContain("new-a");
    expect(out).toContain("new-b");
    expect(out).toContain("mid");
    expect(out.indexOf("new-a")).toBeLessThan(out.indexOf("mid"));
  });
});

describe("merge: managed-blocks errors", () => {
  it("fails on missing markers", () => {
    expect(() => merge("managed-blocks", "no markers here", "content")).toThrow(MergeError);
  });

  it("fails on BEGIN without END", () => {
    const ex = `${BEGIN}\ncontent`;
    const ren = `${BEGIN}\nx\n${END}`;
    expect(() => merge("managed-blocks", ex, ren)).toThrow(MergeError);
  });

  it("fails on END without BEGIN", () => {
    const ex = `content\n${END}`;
    const ren = `${BEGIN}\nx\n${END}`;
    expect(() => merge("managed-blocks", ex, ren)).toThrow(MergeError);
  });

  it("fails on duplicate section names", () => {
    const ex = [BEGIN, "x", END, BEGIN, "y", END].join("\n");
    const ren = [BEGIN, "x", END].join("\n");
    expect(() => merge("managed-blocks", ex, ren)).toThrow(MergeError);
  });

  it("fails on nested markers", () => {
    const nested = [BEGIN, "outer", BEGIN, "inner", END, "outer-end", END].join("\n");
    const ren = `${BEGIN}\nx\n${END}`;
    expect(() => merge("managed-blocks", nested, ren)).toThrow(MergeError);
  });

  it("fails on marker version mismatch", () => {
    const ex = [
      "<!-- DOOZCTL:BEGIN:v2 section-name -->",
      "x",
      "<!-- DOOZCTL:END:v2 section-name -->",
    ].join("\n");
    const ren = `${BEGIN}\nx\n${END}`;
    expect(() => merge("managed-blocks", ex, ren)).toThrow(MergeError);
  });

  it("fails on a malformed marker line", () => {
    const ex = "<!-- DOOZCTL:BEGIN:v1 -->\nx\n" + END; // BEGIN missing a name
    const ren = `${BEGIN}\nx\n${END}`;
    expect(() => merge("managed-blocks", ex, ren)).toThrow(MergeError);
  });

  it("fails when a block exists in existing but not in rendered", () => {
    const ex = `${BEGIN}\nx\n${END}`;
    const ren = "no managed block";
    expect(() => merge("managed-blocks", ex, ren)).toThrow(MergeError);
  });

  it("fails when a block exists in rendered but not in existing", () => {
    const ex = "no managed block";
    const ren = `${BEGIN}\nx\n${END}`;
    expect(() => merge("managed-blocks", ex, ren)).toThrow(MergeError);
  });

  it("never partially merges (original string is untouched by failure)", () => {
    const ex = `${BEGIN}\nx\n${END}`;
    const ren = "no markers";
    expect(() => merge("managed-blocks", ex, ren)).toThrow(MergeError);
    expect(ex).toBe(`${BEGIN}\nx\n${END}`);
  });
});

describe("merge: unknown strategy", () => {
  it("fails on an unknown strategy", () => {
    expect(() => merge("bogus" as never, "a", "b")).toThrow(MergeError);
  });
});
