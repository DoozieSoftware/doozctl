import { describe, expect, it } from "vitest";
import { RepositoryStore } from "./repository-store.js";
import { NotImplementedError } from "../errors.js";
import type { Manifest } from "../model/model.js";

const manifest: Manifest = { version: 1, artifacts: ["AGENTS.md"] };

describe("RepositoryStore", () => {
  it("is constructible", () => {
    expect(new RepositoryStore()).toBeDefined();
  });

  it("is scaffolding for manifest operations", async () => {
    const store = new RepositoryStore();
    await expect(store.loadManifest(".")).rejects.toBeInstanceOf(NotImplementedError);
    await expect(store.saveManifest(".", manifest)).rejects.toBeInstanceOf(NotImplementedError);
  });

  it("is scaffolding for analysis persistence", async () => {
    const store = new RepositoryStore();
    await expect(store.loadAnalysis(".")).rejects.toBeInstanceOf(NotImplementedError);
    await expect(store.saveAnalysis(".", {} as never)).rejects.toBeInstanceOf(NotImplementedError);
  });

  it("is scaffolding for context operations", async () => {
    const store = new RepositoryStore();
    await expect(store.readContext(".")).rejects.toBeInstanceOf(NotImplementedError);
    await expect(store.updateContext(".", "content")).rejects.toBeInstanceOf(NotImplementedError);
  });

  it("is scaffolding for session operations", async () => {
    const store = new RepositoryStore();
    await expect(store.createSession(".", "summary")).rejects.toBeInstanceOf(NotImplementedError);
    await expect(store.listSessions(".")).rejects.toBeInstanceOf(NotImplementedError);
  });
});
