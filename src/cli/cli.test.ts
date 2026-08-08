import { describe, expect, it } from "vitest";
import { Writable } from "node:stream";
import { Dispatcher, ExitCode } from "../dispatcher/dispatcher.js";
import { buildProgram, runCli, VERSION } from "./cli.js";

function capture(): { stdout: Writable; stderr: Writable; out: () => string; err: () => string } {
  let outBuf = "";
  let errBuf = "";
  const stdout = new Writable({
    write(chunk, _enc, cb) {
      outBuf += chunk.toString();
      cb();
    },
  });
  const stderr = new Writable({
    write(chunk, _enc, cb) {
      errBuf += chunk.toString();
      cb();
    },
  });
  return {
    stdout,
    stderr,
    out: () => outBuf,
    err: () => errBuf,
  };
}

function dispatcherWith(): Dispatcher {
  const d = new Dispatcher();
  d.register("ok", async () => ExitCode.OK);
  d.register("fail", async () => 42);
  d.register("boom", async () => Promise.reject(new Error("kaboom")));
  return d;
}

describe("buildProgram", () => {
  it("lists registered commands in the help output", () => {
    const d = dispatcherWith();
    const streams = capture();
    expect(() => buildProgram(d, streams.stdout, streams.stderr).help()).toThrow();
    expect(streams.out()).toContain("ok [args...]");
    expect(streams.out()).toContain("fail [args...]");
  });
});

describe("runCli", () => {
  it("returns 0 for a successful command", async () => {
    const code = await runCli(["ok"], dispatcherWith());
    expect(code).toBe(ExitCode.OK);
  });

  it("returns the handler exit code", async () => {
    const code = await runCli(["fail"], dispatcherWith());
    expect(code).toBe(42);
  });

  it("maps handler errors to exit code 1", async () => {
    const streams = capture();
    const code = await runCli(["boom"], dispatcherWith(), streams);
    expect(code).toBe(ExitCode.Error);
    expect(streams.err()).toContain("kaboom");
  });

  it("prints help and returns 0 when no command is given", async () => {
    const streams = capture();
    const code = await runCli([], dispatcherWith(), streams);
    expect(code).toBe(ExitCode.OK);
    expect(streams.out()).toContain("Usage: doozctl");
  });

  it("prints the version", async () => {
    const streams = capture();
    const code = await runCli(["--version"], dispatcherWith(), streams);
    expect(code).toBe(ExitCode.OK);
    expect(streams.out()).toContain(VERSION);
  });

  it("returns a non-zero code for an unknown command", async () => {
    const code = await runCli(["nope"], dispatcherWith());
    expect(code).not.toBe(ExitCode.OK);
  });

  it("forwards excess arguments to the handler", async () => {
    let seen: string[] = [];
    const d = new Dispatcher();
    d.register("echo", async (args) => {
      seen = args;
      return ExitCode.OK;
    });
    await runCli(["echo", "a", "b"], d);
    expect(seen).toEqual(["a", "b"]);
  });
});
