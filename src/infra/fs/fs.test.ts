import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FileSystem } from "./fs.js";

let root: string;
let fs: FileSystem;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "doozctl-fs-"));
  fs = new FileSystem(root);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("FileSystem", () => {
  it("resolves relative paths inside the root", () => {
    expect(fs.resolve("a", "b.txt")).toBe(path.join(root, "a", "b.txt"));
  });

  it("rejects paths that escape the root", () => {
    expect(() => fs.resolve("..", "secret")).toThrow("escapes sandbox root");
    expect(() => fs.resolve("a", "..", "..", "secret")).toThrow("escapes sandbox root");
  });

  it("reports whether a path exists", async () => {
    await fs.write("hello", "dir", "file.txt");
    await expect(fs.exists("dir", "file.txt")).resolves.toBe(true);
    await expect(fs.exists("dir", "missing.txt")).resolves.toBe(false);
  });

  it("reads back what it writes, creating parents", async () => {
    await fs.write("content", "nested", "deeper", "out.txt");
    await expect(fs.read("nested", "deeper", "out.txt")).resolves.toBe("content");
  });

  it("creates directories recursively", async () => {
    await fs.mkdir("a", "b", "c");
    await writeFile(path.join(root, "a", "b", "c", "leaf.txt"), "leaf");
    await expect(fs.exists("a", "b", "c", "leaf.txt")).resolves.toBe(true);
  });

  it("reads via the raw fs module at the resolved path", async () => {
    await fs.write("raw", "raw.txt");
    await expect(readFile(path.join(root, "raw.txt"), "utf-8")).resolves.toBe("raw");
  });
});
