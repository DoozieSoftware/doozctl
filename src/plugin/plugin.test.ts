import { describe, expect, it } from "vitest";
import { PluginManager } from "./plugin.js";
import { NotImplementedError } from "../errors.js";

describe("PluginManager", () => {
  it("is constructible", () => {
    expect(new PluginManager()).toBeDefined();
  });

  it("is scaffolding", async () => {
    await expect(new PluginManager().discover(".")).rejects.toBeInstanceOf(NotImplementedError);
  });
});
