import { describe, expect, it } from "vitest";
import {
  builtinMergers,
  DefaultAnalyzer,
  DefaultRenderer,
  DefaultStandardsLoader,
  DefaultValidator,
  type Analyzer,
  type Renderer,
  type StandardsLoader,
  type StrategyMerger,
  type Validator,
} from "./contracts.js";
import { NotImplementedError } from "../errors.js";

describe("extension point contracts", () => {
  it("default analyzer is scaffolding", async () => {
    const a: Analyzer = new DefaultAnalyzer();
    await expect(a.analyze(".")).rejects.toBeInstanceOf(NotImplementedError);
  });

  it("default standards loader is scaffolding", async () => {
    const l: StandardsLoader = new DefaultStandardsLoader();
    await expect(l.load(".")).rejects.toBeInstanceOf(NotImplementedError);
  });

  it("default renderer is scaffolding", async () => {
    const r: Renderer = new DefaultRenderer();
    await expect(r.render({} as never, {})).rejects.toBeInstanceOf(NotImplementedError);
  });

  it("default validator is scaffolding", async () => {
    const v: Validator = new DefaultValidator();
    await expect(v.validate("content", null)).rejects.toBeInstanceOf(NotImplementedError);
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

  it("built-in mergers are scaffolding", async () => {
    const m: StrategyMerger = builtinMergers()["managed-blocks"];
    await expect(m.merge({} as never, "rendered", null)).rejects.toBeInstanceOf(
      NotImplementedError,
    );
  });
});
