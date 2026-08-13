import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Plan } from "../model/plan.js";
import { parsePlan, renderPlan, setPlanStatus } from "../model/plan.js";
import { PlanStore } from "./plan-store.js";
import { Storage } from "./storage.js";

/** Fixed clock so creation dates and file names are deterministic. */
const now = () => new Date(2026, 7, 13, 10, 30, 0);
const store = new PlanStore({ now });

const dirs: string[] = [];
afterAll(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

async function tmp(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "doozctl-plan-store-"));
  dirs.push(dir);
  return dir;
}

describe("PlanStore.create", () => {
  it("writes a PLANNED plan under .dooz/plans/active/", async () => {
    const root = await tmp();
    const plan = await store.create(root, { id: "attendance-punch-sync", method: "bug-fix" });

    expect(plan.id).toBe("attendance-punch-sync");
    expect(plan.method).toBe("bug-fix");
    expect(plan.status).toBe("PLANNED");
    expect(plan.created).toBe("2026-08-13");

    const file = path.join(root, ".dooz", "plans", "active", "2026-08-13-attendance-punch-sync.md");
    expect(await readFile(file, "utf-8")).toBe(plan.content);
    expect(await new Storage(root).list(".dooz", "plans", "active")).toEqual([
      "2026-08-13-attendance-punch-sync.md",
    ]);
  });

  it("uses an explicit title in the rendered template", async () => {
    const root = await tmp();
    const plan = await store.create(root, { id: "x", method: "bug-fix", title: "Fix Login" });
    expect(plan.content).toContain("# Fix Login");
  });

  it("is deterministic for the same input and clock", async () => {
    const a = await store.create(await tmp(), { id: "det", method: "bug-fix" });
    const b = await store.create(await tmp(), { id: "det", method: "bug-fix" });
    expect(a.content).toBe(b.content);
  });

  it("rejects an invalid id before writing anything", async () => {
    for (const id of ["../escape", "a/b", "a\\b", "..", "with space", "Uppercase"]) {
      const root = await tmp();
      await expect(store.create(root, { id, method: "bug-fix" })).rejects.toThrow(
        /invalid plan id/,
      );
      expect(await new Storage(root).list(".dooz", "plans", "active")).toEqual([]);
    }
  });

  it("rejects an empty method", async () => {
    const root = await tmp();
    await expect(store.create(root, { id: "x", method: "  " })).rejects.toThrow(
      /method must not be empty/,
    );
  });

  it("rejects a duplicate plan id on the same date", async () => {
    const root = await tmp();
    await store.create(root, { id: "dup", method: "bug-fix" });
    await expect(store.create(root, { id: "dup", method: "bug-fix" })).rejects.toThrow(
      /plan already exists/,
    );
  });

  it("allows the same id on a different date", async () => {
    const root = await tmp();
    await store.create(root, { id: "reused", method: "bug-fix" });
    const store2 = new PlanStore({ now: () => new Date(2026, 7, 14, 9, 0, 0) });
    const plan = await store2.create(root, { id: "reused", method: "bug-fix" });
    expect(plan.created).toBe("2026-08-14");
  });
});

describe("PlanStore.load", () => {
  it("round-trips a created plan", async () => {
    const root = await tmp();
    const created = await store.create(root, { id: "attendance-punch-sync", method: "bug-fix" });
    await expect(store.load(root, "attendance-punch-sync")).resolves.toEqual(created);
  });

  it("throws for a missing plan", async () => {
    const root = await tmp();
    await expect(store.load(root, "missing-plan")).rejects.toThrow(/plan not found/);
  });

  it("rejects an invalid id", async () => {
    const root = await tmp();
    await expect(store.load(root, "../escape")).rejects.toThrow(/invalid plan id/);
  });

  it("throws on a corrupted plan file instead of guessing", async () => {
    const root = await tmp();
    await store.create(root, { id: "corrupt", method: "bug-fix" });
    await new Storage(root).atomicWrite(
      "this is not a plan",
      ".dooz",
      "plans",
      "active",
      "2026-08-13-corrupt.md",
    );
    await expect(store.load(root, "corrupt")).rejects.toThrow(/plan/);
  });

  it("throws when the same id exists in both active/ and completed/", async () => {
    const root = await tmp();
    const created = await store.create(root, { id: "dup", method: "bug-fix" });
    const filename = "2026-08-13-dup.md";
    await new Storage(root).atomicWrite(
      setPlanStatus(created.content, "COMPLETED"),
      ".dooz",
      "plans",
      "completed",
      filename,
    );
    await expect(store.load(root, "dup")).rejects.toThrow(/ambiguous/);
  });

  it("ignores non-plan files in the directories", async () => {
    const root = await tmp();
    await store.create(root, { id: "real", method: "bug-fix" });
    await new Storage(root).atomicWrite("x", ".dooz", "plans", "active", "notes.txt");
    await expect(store.load(root, "real")).resolves.toMatchObject({ id: "real" });
  });
});

describe("PlanStore.list", () => {
  it("lists plans in the requested state, sorted", async () => {
    const root = await tmp();
    await store.create(root, { id: "beta", method: "bug-fix" });
    await new PlanStore({ now: () => new Date(2026, 7, 12, 9, 0, 0) }).create(root, {
      id: "alpha",
      method: "investigation",
    });
    expect(await store.list(root, "active")).toEqual(["2026-08-12-alpha.md", "2026-08-13-beta.md"]);
    expect(await store.list(root, "completed")).toEqual([]);
  });
});

describe("PlanStore.update", () => {
  it("persists body content in place", async () => {
    const root = await tmp();
    const created = await store.create(root, { id: "my-plan", method: "bug-fix" });
    const updatedContent = created.content.replace(
      "## Objective",
      "## Objective\n\nShrink the payload.",
    );
    const updated = await store.update(root, "my-plan", updatedContent);

    expect(updated.content).toBe(updatedContent);
    expect(updated.status).toBe("PLANNED");
    expect(updated.created).toBe("2026-08-13");
    const file = path.join(root, ".dooz", "plans", "active", "2026-08-13-my-plan.md");
    expect(await readFile(file, "utf-8")).toBe(updatedContent);
  });

  it("is idempotent: a byte-identical update writes nothing", async () => {
    const root = await tmp();
    const created = await store.create(root, { id: "my-plan", method: "bug-fix" });
    const before = await new Storage(root).read(
      ".dooz",
      "plans",
      "active",
      "2026-08-13-my-plan.md",
    );
    const updated = await store.update(root, "my-plan", created.content);
    const after = await new Storage(root).read(".dooz", "plans", "active", "2026-08-13-my-plan.md");
    expect(updated.content).toBe(created.content);
    expect(after).toBe(before);
  });

  it("rejects changing the plan id", async () => {
    const root = await tmp();
    const created = await store.create(root, { id: "my-plan", method: "bug-fix" });
    const content = created.content.replace("- id: my-plan", "- id: other");
    await expect(store.update(root, "my-plan", content)).rejects.toThrow(
      /cannot change the plan id/,
    );
  });

  it("rejects changing the created date", async () => {
    const root = await tmp();
    const created = await store.create(root, { id: "my-plan", method: "bug-fix" });
    const content = created.content.replace("- created: 2026-08-13", "- created: 2026-08-14");
    await expect(store.update(root, "my-plan", content)).rejects.toThrow(
      /cannot change the plan creation date/,
    );
  });

  it("rejects changing the status; transition is the only way", async () => {
    const root = await tmp();
    const created = await store.create(root, { id: "my-plan", method: "bug-fix" });
    const content = setPlanStatus(created.content, "EXECUTING");
    await expect(store.update(root, "my-plan", content)).rejects.toThrow(
      /cannot change the plan status/,
    );
  });

  it("rejects malformed content", async () => {
    const root = await tmp();
    await store.create(root, { id: "my-plan", method: "bug-fix" });
    await expect(store.update(root, "my-plan", "not a plan")).rejects.toThrow(/plan/);
  });
});

describe("PlanStore.transition", () => {
  it("advances the status in place for forward transitions", async () => {
    const root = await tmp();
    await store.create(root, { id: "my-plan", method: "bug-fix" });
    await store.transition(root, "my-plan", "EXECUTING");
    await store.transition(root, "my-plan", "VERIFIED");
    const plan = await store.load(root, "my-plan");
    expect(plan.status).toBe("VERIFIED");
    expect(plan.content).toContain("- status: VERIFIED");
    expect(await store.list(root, "active")).toContain("2026-08-13-my-plan.md");
  });

  it("supports skips along the lifecycle", async () => {
    const root = await tmp();
    await store.create(root, { id: "my-plan", method: "bug-fix" });
    const plan = await store.transition(root, "my-plan", "COMPLETED");
    expect(plan.status).toBe("COMPLETED");
  });

  it("is an idempotent no-op for the same status", async () => {
    const root = await tmp();
    const created = await store.create(root, { id: "my-plan", method: "bug-fix" });
    const plan = await store.transition(root, "my-plan", "PLANNED");
    expect(plan).toEqual(created);
    expect(await store.list(root, "active")).toContain("2026-08-13-my-plan.md");
  });

  it("moves a completed plan from active/ to completed/", async () => {
    const root = await tmp();
    await store.create(root, { id: "my-plan", method: "bug-fix" });
    const completed = await store.transition(root, "my-plan", "COMPLETED");

    expect(completed.status).toBe("COMPLETED");
    expect(await store.list(root, "active")).toEqual([]);
    expect(await store.list(root, "completed")).toEqual(["2026-08-13-my-plan.md"]);
    const file = path.join(root, ".dooz", "plans", "completed", "2026-08-13-my-plan.md");
    expect(await readFile(file, "utf-8")).toContain("- status: COMPLETED");
  });

  it("loads a plan after it has moved to completed/", async () => {
    const root = await tmp();
    await store.create(root, { id: "my-plan", method: "bug-fix" });
    await store.transition(root, "my-plan", "COMPLETED");
    await expect(store.load(root, "my-plan")).resolves.toMatchObject({ status: "COMPLETED" });
  });

  it("rejects a backwards transition and leaves the plan untouched", async () => {
    const root = await tmp();
    await store.create(root, { id: "my-plan", method: "bug-fix" });
    await store.transition(root, "my-plan", "EXECUTING");
    const before = await store.load(root, "my-plan");
    await expect(store.transition(root, "my-plan", "PLANNED")).rejects.toThrow(
      /backwards plan transition/,
    );
    await expect(store.load(root, "my-plan")).resolves.toEqual(before);
  });

  it("cannot move a completed plan backwards into active/", async () => {
    const root = await tmp();
    await store.create(root, { id: "my-plan", method: "bug-fix" });
    await store.transition(root, "my-plan", "COMPLETED");
    await expect(store.transition(root, "my-plan", "EXECUTING")).rejects.toThrow(
      /backwards plan transition/,
    );
    expect(await store.list(root, "active")).toEqual([]);
    expect(await store.list(root, "completed")).toEqual(["2026-08-13-my-plan.md"]);
  });

  it("rejects unknown statuses", async () => {
    const root = await tmp();
    await store.create(root, { id: "my-plan", method: "bug-fix" });
    await expect(store.transition(root, "my-plan", "DONE" as never)).rejects.toThrow(
      /unknown plan status/,
    );
    expect(await store.list(root, "active")).toContain("2026-08-13-my-plan.md");
  });

  it("rejects transitions to ABANDONED", async () => {
    const root = await tmp();
    await store.create(root, { id: "my-plan", method: "bug-fix" });
    await expect(store.transition(root, "my-plan", "ABANDONED")).rejects.toThrow(/ABANDONED/);
  });

  it("rejects a transition for a missing plan", async () => {
    const root = await tmp();
    await expect(store.transition(root, "missing", "EXECUTING")).rejects.toThrow(/plan not found/);
  });
});

describe("PlanStore round trip", () => {
  it("parsePlan(renderPlan(...)) is a stable, deterministic serialization", async () => {
    const root = await tmp();
    const plan = await store.create(root, { id: "round-trip", method: "bug-fix" });
    const reparsed = parsePlan(renderPlan({ id: "round-trip", method: "bug-fix" }, plan.created));
    expect(reparsed).toEqual(plan);
  });

  it("produces plans that parse without loss", async () => {
    const root = await tmp();
    const plan: Plan = await store.create(root, { id: "lossless", method: "investigation" });
    const loaded = await store.load(root, "lossless");
    expect(loaded).toEqual(plan);
  });
});
