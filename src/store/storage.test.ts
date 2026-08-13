import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Storage } from "./storage.js";

let root: string;
let storage: Storage;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "doozctl-storage-"));
  storage = new Storage(root);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("Storage", () => {
  describe("resolve", () => {
    it("resolves relative paths inside the root", () => {
      expect(storage.resolve("a", "b.txt")).toBe(path.join(root, "a", "b.txt"));
    });

    it("rejects paths that escape the root", () => {
      expect(() => storage.resolve("..", "secret.txt")).toThrow("escapes sandbox root");
      expect(() => storage.resolve("a", "..", "..", "secret.txt")).toThrow("escapes sandbox root");
    });
  });

  describe("exists", () => {
    it("reports whether a file exists", async () => {
      await storage.write("hello", "probe.txt");
      await expect(storage.exists("probe.txt")).resolves.toBe(true);
      await expect(storage.exists("missing.txt")).resolves.toBe(false);
    });
  });

  describe("read and write", () => {
    it("reads back what it writes, creating parents", async () => {
      await storage.write("content", "nested", "deeper", "out.txt");
      await expect(storage.read("nested", "deeper", "out.txt")).resolves.toBe("content");
    });

    it("writes via the raw fs module at the resolved path", async () => {
      await storage.write("raw", "raw.txt");
      await expect(readFile(path.join(root, "raw.txt"), "utf-8")).resolves.toBe("raw");
    });
  });

  describe("mkdir", () => {
    it("creates directories recursively", async () => {
      await storage.mkdir("a", "b", "c");
      await writeFile(path.join(root, "a", "b", "c", "leaf.txt"), "leaf", "utf-8");
      await expect(storage.exists("a", "b", "c", "leaf.txt")).resolves.toBe(true);
    });
  });

  describe("atomicWrite", () => {
    it("writes content through nested paths, creating directories", async () => {
      await storage.atomicWrite("state", "cache", "state.txt");
      await expect(storage.read("cache", "state.txt")).resolves.toBe("state");
    });

    it("leaves no temp files behind after a successful write", async () => {
      await storage.atomicWrite("ok", "atomic", "state.txt");
      await expect(readdir(storage.resolve("atomic"))).resolves.toEqual(["state.txt"]);
    });

    it("cleans up the temp file and rejects when the target cannot be renamed", async () => {
      await storage.mkdir("atomic-blocked", "blocked.txt");
      await expect(storage.atomicWrite("ok", "atomic-blocked", "blocked.txt")).rejects.toThrow();
      await expect(readdir(storage.resolve("atomic-blocked"))).resolves.toEqual(["blocked.txt"]);
    });

    it("overwrites an existing file", async () => {
      await storage.atomicWrite("v1", "overwrite.txt");
      await storage.atomicWrite("v2", "overwrite.txt");
      await expect(storage.read("overwrite.txt")).resolves.toBe("v2");
    });
  });

  describe("delete", () => {
    it("removes a file", async () => {
      await storage.write("gone", "remove.txt");
      await storage.delete("remove.txt");
      await expect(storage.exists("remove.txt")).resolves.toBe(false);
    });

    it("is a no-op for a missing file", async () => {
      await expect(storage.delete("never-existed.txt")).resolves.toBeUndefined();
    });
  });

  describe("path safety", () => {
    it("never writes outside the repository root", async () => {
      await expect(storage.write("x", "..", "..", "evil.txt")).rejects.toThrow(
        "escapes sandbox root",
      );
      await expect(storage.read("..", "..", "evil.txt")).rejects.toThrow("escapes sandbox root");
    });

    it("rejects deletes that escape the root", async () => {
      await expect(storage.delete("..", "outside.txt")).rejects.toThrow("escapes sandbox root");
    });
  });

  describe("realpath containment", () => {
    let symlinksSupported = true;

    beforeAll(async () => {
      const probe = await mkdtemp(path.join(tmpdir(), "doozctl-symlink-probe-"));
      try {
        await symlink(path.join(probe, "target"), path.join(probe, "link"));
      } catch {
        symlinksSupported = false;
      }
      await rm(probe, { recursive: true, force: true });
    });

    it("rejects writing through a symlink that escapes the root", async () => {
      if (!symlinksSupported) return;
      const outside = await mkdtemp(path.join(tmpdir(), "doozctl-outside-file-"));
      try {
        await writeFile(path.join(outside, "secret.txt"), "secret", "utf-8");
        await symlink(path.join(outside, "secret.txt"), path.join(root, "escaped.txt"));
        await expect(storage.write("pwned", "escaped.txt")).rejects.toThrow("escapes sandbox root");
        await expect(readFile(path.join(outside, "secret.txt"), "utf-8")).resolves.toBe("secret");
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    });

    it("rejects read and write through a symlinked parent directory", async () => {
      if (!symlinksSupported) return;
      const outside = await mkdtemp(path.join(tmpdir(), "doozctl-outside-dir-"));
      try {
        await symlink(outside, path.join(root, "linked-dir"));
        await expect(storage.write("x", "linked-dir", "file.txt")).rejects.toThrow(
          "escapes sandbox root",
        );
        await expect(storage.read("linked-dir", "file.txt")).rejects.toThrow(
          "escapes sandbox root",
        );
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    });

    it("rejects atomicWrite through a symlinked final component", async () => {
      if (!symlinksSupported) return;
      const outside = await mkdtemp(path.join(tmpdir(), "doozctl-outside-atomic-"));
      try {
        await writeFile(path.join(outside, "state.txt"), "keep", "utf-8");
        await symlink(path.join(outside, "state.txt"), path.join(root, "escaped-state.txt"));
        await expect(storage.atomicWrite("pwned", "escaped-state.txt")).rejects.toThrow(
          "escapes sandbox root",
        );
        await expect(readFile(path.join(outside, "state.txt"), "utf-8")).resolves.toBe("keep");
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    });

    it("rejects writing through a dangling symlink that would create a file outside the root", async () => {
      if (!symlinksSupported) return;
      const outside = await mkdtemp(path.join(tmpdir(), "doozctl-outside-dangling-"));
      try {
        await mkdir(path.join(outside, "dir"), { recursive: true });
        await symlink(
          path.join(outside, "dir", "newfile.txt"),
          path.join(root, "dangling-link.txt"),
        );
        await expect(storage.write("pwned", "dangling-link.txt")).rejects.toThrow(
          "escapes sandbox root",
        );
        await expect(
          readFile(path.join(outside, "dir", "newfile.txt"), "utf-8"),
        ).rejects.toMatchObject({ code: "ENOENT" });
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    });

    it("rejects deleting through a symlink that escapes the root", async () => {
      if (!symlinksSupported) return;
      const outside = await mkdtemp(path.join(tmpdir(), "doozctl-outside-delete-"));
      try {
        await writeFile(path.join(outside, "secret.txt"), "secret", "utf-8");
        await symlink(path.join(outside, "secret.txt"), path.join(root, "escaped-delete.txt"));
        await expect(storage.delete("escaped-delete.txt")).rejects.toThrow("escapes sandbox root");
        await expect(readFile(path.join(outside, "secret.txt"), "utf-8")).resolves.toBe("secret");
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    });
  });
});
