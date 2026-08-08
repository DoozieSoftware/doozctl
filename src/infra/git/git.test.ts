import { describe, expect, it } from "vitest";
import { GitService } from "./git.js";
import { NotImplementedError } from "../../errors.js";

describe("GitService", () => {
  it("is constructible", () => {
    expect(new GitService()).toBeDefined();
  });

  it("is scaffolding", async () => {
    await expect(new GitService().detect(".")).rejects.toBeInstanceOf(NotImplementedError);
  });
});
