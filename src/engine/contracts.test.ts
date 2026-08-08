import { describe, expect, it } from "vitest";
import {
  builtinMergers,
  DefaultAnalyzer,
  DefaultStandardsLoader,
  DefaultValidator,
} from "./contracts.js";

describe("extension point contracts", () => {
  it("default analyzer delegates to the repository analyzer", async () => {
    const git = { detect: async () => null };
    const analysis = await new DefaultAnalyzer(git).analyze(".");
    expect(analysis).toMatchObject({ root: expect.any(String), languages: expect.any(Array) });
  });

  it("default standards loader delegates to the package loader", async () => {
    const loader = new DefaultStandardsLoader();
    await expect(loader.load("/does/not/exist")).rejects.toThrow(/standards package not found/);
  });

  it("default validator accepts any content", async () => {
    const v = new DefaultValidator();
    await expect(v.validate("content", "schemas/a.json")).resolves.toBeUndefined();
    await expect(v.validate("content", null)).resolves.toBeUndefined();
  });

  it("provides a merger for every built-in merge strategy", () => {
    const mergers = builtinMergers();
    expect(Object.keys(mergers).sort()).toEqual([
      "append",
      "managed-blocks",
      "overwrite",
      "replace-generated",
    ]);
  });

  it("built-in mergers apply the frozen merge semantics", async () => {
    const mergers = builtinMergers();
    // overwrite replaces content outright.
    await expect(mergers.overwrite.merge({} as never, "new", "old")).resolves.toBe("new");
    // managed-blocks on a missing destination writes directly.
    await expect(mergers["managed-blocks"].merge({} as never, "rendered", null)).resolves.toBe(
      "rendered",
    );
  });
});
