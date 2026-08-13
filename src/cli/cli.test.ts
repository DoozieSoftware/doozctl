import { describe, expect, it } from "vitest";
import { Writable } from "node:stream";
import { Dispatcher, ExitCode } from "../dispatcher/dispatcher.js";
import { UsageError } from "../errors.js";
import { DEFAULT_METHOD, listWorkflowMethodIds } from "../workflows/methods.js";
import { buildProgram, humanizeError, planCommandHelp, runCli, VERSION } from "./cli.js";

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

describe("planCommandHelp", () => {
  it("explains what a plan is, where it is stored, the methods, and examples", () => {
    const help = planCommandHelp(listWorkflowMethodIds(), DEFAULT_METHOD);
    expect(help.description).toContain("Plan");
    expect(help.helpText).toContain(".dooz/plans/active/");
    expect(help.helpText).toContain("Methods: bug-fix, feature, investigation, standard, triage");
    expect(help.helpText).toContain("(default: standard)");
    expect(help.helpText).toContain("doozctl plan");
    expect(help.helpText).toContain("doozctl plan --method bug-fix");
  });

  it("renders plan help through the CLI with the available methods", async () => {
    const streams = capture();
    const d = new Dispatcher().register("plan", async () => ExitCode.OK);
    const code = await runCli(["plan", "--help"], d, {
      ...streams,
      help: { plan: planCommandHelp(listWorkflowMethodIds(), DEFAULT_METHOD) },
    });
    expect(code).toBe(ExitCode.OK);
    expect(streams.out()).toContain("Create a repository-local engineering Plan");
    expect(streams.out()).toContain("Methods: bug-fix, feature, investigation, standard, triage");
  });
});

describe("humanizeError", () => {
  it("rewrites a missing-standards-package error with guidance", () => {
    const message = humanizeError(new Error("standards package not found: /tmp/nope/package.json"));
    expect(message).toContain("Standards package not found at /tmp/nope/package.json");
    expect(message).toContain("Pass a directory that contains a standards package");
  });

  it("rewrites an unmanaged-file merge error with guidance", () => {
    const message = humanizeError(new Error("merge: existing file has no managed block markers"));
    expect(message).toContain("was left untouched");
    expect(message).toContain("Convert that file to a managed-blocks artifact");
  });

  it("rewrites a replace-generated refusal with guidance", () => {
    const message = humanizeError(
      new Error(
        "merge: existing file is not engine-generated; refusing replace-generated overwrite",
      ),
    );
    expect(message).toContain("was left untouched");
    expect(message).toContain("carry the engine-generated marker");
  });

  it("passes through unknown errors unchanged", () => {
    expect(humanizeError(new Error("kaboom"))).toBe("kaboom");
  });

  it("reports a duplicate plan and gives a next action without overwriting", () => {
    const message = humanizeError(new Error("plan already exists: standard"));
    expect(message).toContain("Plan already exists: standard");
    expect(message).toContain("left untouched");
    expect(message).toContain("--title");
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

  it("maps usage errors to exit code 2", async () => {
    const streams = capture();
    const d = new Dispatcher();
    d.register("usage", async () => {
      throw new UsageError("Usage: doozctl usage <x>");
    });
    const code = await runCli(["usage"], d, streams);
    expect(code).toBe(ExitCode.Usage);
    expect(streams.err()).toContain("Usage: doozctl usage");
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
