import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { StandardsPackageLoader } from "./standards-loader.js";

const loader = new StandardsPackageLoader();

const dirs: string[] = [];

afterAll(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

async function tmp(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "doozctl-pkg-"));
  dirs.push(dir);
  return dir;
}

/** Write a manifest plus optional package files. */
async function writePackage(
  dir: string,
  manifest: unknown,
  files: Record<string, string> = {},
): Promise<void> {
  await writeFile(path.join(dir, "package.json"), JSON.stringify(manifest, null, 2), "utf-8");
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, rel);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, content, "utf-8");
  }
}

const validManifest = {
  format: 2,
  name: "@dooziesoft/standards",
  version: "1.0.0",
  engine: ">=1.0.0",
  artifacts: [
    {
      id: "agents",
      source: "artifacts/AGENTS.md",
      destination: "AGENTS.md",
      merge: "managed-blocks",
      lifecycle: ["init", "sync"],
    },
    {
      id: "wrappers",
      source: "artifacts/README.md",
      destination: "docs/README.md",
      merge: "overwrite",
      lifecycle: ["sync"],
    },
  ],
};

describe("StandardsPackageLoader", () => {
  it("loads a valid package into generic artifacts", async () => {
    const dir = await tmp();
    await writePackage(dir, validManifest, {
      "artifacts/AGENTS.md": "content",
      "artifacts/README.md": "content",
    });

    const pkg = await loader.load(dir);

    expect(pkg.format).toBe(2);
    expect(pkg.name).toBe("@dooziesoft/standards");
    expect(pkg.version).toBe("1.0.0");
    expect(pkg.engine).toBe(">=1.0.0");
    expect(pkg.artifacts).toHaveLength(2);
    expect(pkg.artifacts[0]).toMatchObject({
      id: "agents",
      source: { path: "artifacts/AGENTS.md" },
      destination: { path: "AGENTS.md" },
      mergeStrategy: "managed-blocks",
      lifecycle: ["init", "sync"],
    });
    expect(pkg.artifacts[1]?.mergeStrategy).toBe("overwrite");
    expect(pkg.artifacts[1]?.lifecycle).toEqual(["sync"]);
  });

  it("does not read artifact contents", async () => {
    const dir = await tmp();
    await writePackage(dir, validManifest, {
      "artifacts/AGENTS.md": "{{analysis.language}}",
      "artifacts/README.md": "other",
    });
    const pkg = await loader.load(dir);
    expect(pkg.artifacts[0]).toMatchObject({ source: { path: "artifacts/AGENTS.md" } });
  });

  it("loads a package with no artifacts", async () => {
    const dir = await tmp();
    await writePackage(dir, { ...validManifest, artifacts: [] });
    const pkg = await loader.load(dir);
    expect(pkg.artifacts).toEqual([]);
  });

  it("rejects when the package does not exist", async () => {
    const dir = await tmp();
    await expect(loader.load(dir)).rejects.toThrow(/not found/);
  });

  it("rejects invalid JSON", async () => {
    const dir = await tmp();
    await writeFile(path.join(dir, "package.json"), "{not json", "utf-8");
    await expect(loader.load(dir)).rejects.toThrow(/invalid JSON/);
  });

  it("rejects an unsupported format", async () => {
    const dir = await tmp();
    await writePackage(
      dir,
      { ...validManifest, format: 99 },
      { "artifacts/AGENTS.md": "x", "artifacts/README.md": "x" },
    );
    await expect(loader.load(dir)).rejects.toThrow(/unsupported format: 99/);
  });

  it("rejects an unknown merge strategy", async () => {
    const dir = await tmp();
    await writePackage(dir, {
      ...validManifest,
      artifacts: [{ ...validManifest.artifacts[0], merge: "merge-everything" }],
    });
    await expect(loader.load(dir)).rejects.toThrow(/unsupported merge strategy/);
  });

  it("rejects an artifact without a lifecycle", async () => {
    const dir = await tmp();
    await writePackage(
      dir,
      {
        ...validManifest,
        artifacts: [
          {
            id: "agents",
            source: "artifacts/AGENTS.md",
            destination: "AGENTS.md",
            merge: "managed-blocks",
          },
        ],
      },
      { "artifacts/AGENTS.md": "x" },
    );
    await expect(loader.load(dir)).rejects.toThrow(/lifecycle must be a non-empty array/);
  });

  it("rejects an empty lifecycle array", async () => {
    const dir = await tmp();
    await writePackage(dir, {
      ...validManifest,
      artifacts: [{ ...validManifest.artifacts[0], lifecycle: [] }],
    });
    await expect(loader.load(dir)).rejects.toThrow(/lifecycle must be a non-empty array/);
  });

  it("rejects a lifecycle value outside the supported workflows", async () => {
    const dir = await tmp();
    await writePackage(dir, {
      ...validManifest,
      artifacts: [{ ...validManifest.artifacts[0], lifecycle: ["deploy"] }],
    });
    await expect(loader.load(dir)).rejects.toThrow(/unsupported lifecycle value: deploy/);
  });

  it("rejects when an artifact source file is missing", async () => {
    const dir = await tmp();
    await writePackage(dir, validManifest);
    await expect(loader.load(dir)).rejects.toThrow(/source not found/);
  });

  it("rejects a missing manifest field", async () => {
    const dir = await tmp();
    const withoutVersion = {
      format: validManifest.format,
      name: validManifest.name,
      engine: validManifest.engine,
      artifacts: validManifest.artifacts,
    };
    await writePackage(dir, withoutVersion, { "artifacts/AGENTS.md": "x" });
    await expect(loader.load(dir)).rejects.toThrow(/missing version/);
  });

  it("rejects an artifact source that escapes the package", async () => {
    const dir = await tmp();
    await writePackage(dir, {
      ...validManifest,
      artifacts: [{ ...validManifest.artifacts[0], source: "../outside.md" }],
    });
    await expect(loader.load(dir)).rejects.toThrow(/escapes sandbox root/);
  });

  it("rejects a manifest that is not an object", async () => {
    const dir = await tmp();
    await writeFile(path.join(dir, "package.json"), "42", "utf-8");
    await expect(loader.load(dir)).rejects.toThrow(/manifest must be an object/);
  });

  it("rejects artifacts that are not an array", async () => {
    const dir = await tmp();
    await writePackage(dir, { ...validManifest, artifacts: "not-an-array" });
    await expect(loader.load(dir)).rejects.toThrow(/artifacts must be an array/);
  });

  it("rejects a non-string manifest field", async () => {
    const dir = await tmp();
    await writePackage(dir, { ...validManifest, name: 42 });
    await expect(loader.load(dir)).rejects.toThrow(/missing name/);
  });

  it("rejects a non-string artifact field", async () => {
    const dir = await tmp();
    await writePackage(dir, {
      ...validManifest,
      artifacts: [{ ...validManifest.artifacts[0], destination: 42 }],
    });
    await expect(loader.load(dir)).rejects.toThrow(/missing destination/);
  });

  it("is deterministic for identical packages", async () => {
    const a = await tmp();
    const b = await tmp();
    await writePackage(a, validManifest, {
      "artifacts/AGENTS.md": "x",
      "artifacts/README.md": "y",
    });
    await writePackage(b, validManifest, {
      "artifacts/AGENTS.md": "x",
      "artifacts/README.md": "y",
    });
    expect(await loader.load(a)).toEqual(await loader.load(b));
  });
});
