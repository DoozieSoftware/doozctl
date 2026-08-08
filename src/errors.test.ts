import { describe, expect, it } from "vitest";
import { NotImplementedError } from "./errors.js";

describe("NotImplementedError", () => {
  it("carries the module name in its message", () => {
    const err = new NotImplementedError("analyzer");
    expect(err.message).toBe("analyzer: not implemented");
    expect(err.name).toBe("NotImplementedError");
  });

  it("is an instance of Error", () => {
    expect(new NotImplementedError("loader")).toBeInstanceOf(Error);
  });
});
