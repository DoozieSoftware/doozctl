import { describe, expect, it } from "vitest";
import { UsageError } from "./errors.js";
import { ExitCode } from "./dispatcher/dispatcher.js";

describe("UsageError", () => {
  it("carries the message and its name", () => {
    const err = new UsageError("Usage: doozctl init <repo> <package>");
    expect(err.message).toContain("Usage: doozctl init");
    expect(err.name).toBe("UsageError");
  });

  it("maps to exit code 2", () => {
    expect(new UsageError("x").exitCode).toBe(ExitCode.Usage);
  });

  it("is an instance of Error", () => {
    expect(new UsageError("x")).toBeInstanceOf(Error);
  });
});
