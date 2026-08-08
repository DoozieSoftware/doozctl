import { describe, expect, it } from "vitest";
import { Dispatcher, ExitCode } from "./dispatcher.js";

describe("Dispatcher", () => {
  it("registers and dispatches to a handler", async () => {
    let called: string[] = [];
    const d = new Dispatcher();
    d.register("test", async (args) => {
      called = args;
      return ExitCode.OK;
    });

    const code = await d.dispatch("test", ["a", "b"]);
    expect(code).toBe(ExitCode.OK);
    expect(called).toEqual(["a", "b"]);
  });

  it("throws for an unknown command", async () => {
    const d = new Dispatcher();
    await expect(d.dispatch("nope", [])).rejects.toThrow("unknown command: nope");
  });

  it("lists registered commands sorted", () => {
    const d = new Dispatcher();
    d.register("sync", async () => ExitCode.OK);
    d.register("init", async () => ExitCode.OK);
    expect(d.commands()).toEqual(["init", "sync"]);
  });

  it("supports chained registration", () => {
    const d = new Dispatcher();
    d.register("a", async () => ExitCode.OK).register("b", async () => ExitCode.OK);
    expect(d.commands()).toEqual(["a", "b"]);
  });
});
