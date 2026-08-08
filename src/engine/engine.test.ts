import { describe, expect, it } from "vitest";
import { Engine, type PipelineStep } from "./engine.js";
import { NotImplementedError } from "../errors.js";

describe("Engine", () => {
  it("runs steps in order until the first failure", async () => {
    const calls: string[] = [];
    const engine = new Engine();
    const steps = [
      async () => {
        calls.push("first");
      },
      async () => {
        calls.push("second");
        throw new Error("boom");
      },
      async () => {
        calls.push("third");
      },
    ];

    await expect(engine.run({ root: ".", standardsDir: "" }, steps)).rejects.toThrow("boom");
    expect(calls).toEqual(["first", "second"]);
  });

  it("shares an execution context across steps", async () => {
    let observed: string | null = null;
    const engine = new Engine();
    const steps: PipelineStep[] = [
      async (ctx) => {
        ctx.analysis = { languages: ["TypeScript"] } as never;
      },
      async (ctx) => {
        observed = ctx.analysis?.languages[0] ?? null;
      },
    ];

    await engine.run({ root: ".", standardsDir: "" }, steps);
    expect(observed).toBe("TypeScript");
  });

  it("executes exactly the steps it is given", async () => {
    const calls: string[] = [];
    const engine = new Engine();
    await engine.run({ root: ".", standardsDir: "" }, [
      async () => {
        calls.push("only");
      },
    ]);
    expect(calls).toEqual(["only"]);
  });

  it("default steps are scaffolding", async () => {
    const engine = new Engine();
    await expect(
      engine.run({ root: ".", standardsDir: "" }, [
        async () => {
          throw new NotImplementedError("engine");
        },
      ]),
    ).rejects.toBeInstanceOf(NotImplementedError);
  });
});
