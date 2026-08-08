import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { NotImplementedError } from "../errors.js";
import type { Analysis, Manifest } from "../model/model.js";
import { RepositoryStore } from "./repository-store.js";

const store = new RepositoryStore();
const manifest: Manifest = { version: 1, artifacts: ["AGENTS.md"] };

const analysis: Analysis = {
  root: "/repo",
  git: { isRepository: true, branch: "main", dirty: false },
  languages: ["TypeScript"],
  frameworks: [],
  buildSystem: null,
  packageManager: "pnpm",
  testFramework: null,
  ci: [],
  docker: false,
  statistics: { totalFiles: 1, sourceFiles: 1, testFiles: 0 },
  aiFiles: [],
};

const dirs: string[] = [];
afterAll(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

async function tmp(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "doozctl-store-"));
  dirs.push(dir);
  return dir;
}

describe("RepositoryStore", () => {
  it("is constructible", () => {
    expect(store).toBeDefined();
  });

  it("round-trips the manifest through canonical JSON", async () => {
    const dir = await tmp();
    await store.saveManifest(dir, manifest);
    await expect(store.loadManifest(dir)).resolves.toEqual(manifest);
  });

  it("writes the manifest to .dooz/manifest.json", async () => {
    const dir = await tmp();
    await store.saveManifest(dir, manifest);
    await expect(readFile(path.join(dir, ".dooz", "manifest.json"), "utf-8")).resolves.toContain(
      '"artifacts"',
    );
  });

  it("round-trips the repository analysis through canonical JSON", async () => {
    const dir = await tmp();
    await store.saveAnalysis(dir, analysis);
    await expect(store.loadAnalysis(dir)).resolves.toEqual(analysis);
  });

  it("writes the analysis to .ai/repository-analysis.json", async () => {
    const dir = await tmp();
    await store.saveAnalysis(dir, analysis);
    await expect(
      readFile(path.join(dir, ".ai", "repository-analysis.json"), "utf-8"),
    ).resolves.toContain('"languages"');
  });

  it("is scaffolding for context operations", async () => {
    await expect(store.readContext(".")).rejects.toBeInstanceOf(NotImplementedError);
    await expect(store.updateContext(".", "content")).rejects.toBeInstanceOf(NotImplementedError);
  });

  it("is scaffolding for session operations", async () => {
    await expect(store.createSession(".", "summary")).rejects.toBeInstanceOf(NotImplementedError);
    await expect(store.listSessions(".")).rejects.toBeInstanceOf(NotImplementedError);
  });
});
