import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  DEFAULT_METHOD,
  isValidWorkflowMethodId,
  resolveAdoptedWorkflow,
  workflowFilename,
} from "./adoption.js";

const dirs: string[] = [];
afterAll(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

async function tmp(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "doozctl-adoption-"));
  dirs.push(dir);
  return dir;
}

/** A minimal valid workflow document declaring the given id. */
function workflowContent(id: string): string {
  return [
    `# ${id}`,
    "",
    "## Metadata",
    "",
    `- id: ${id}`,
    "",
    "## Purpose",
    "",
    "Test method.",
  ].join("\n");
}

/** Write a workflow document into a control-plane directory. */
async function adopt(
  repo: string,
  place: "adopted" | "project",
  id: string,
  content: string = workflowContent(id),
): Promise<void> {
  const base = path.join(repo, ".dooz", "workflows", place);
  await mkdir(base, { recursive: true });
  await writeFile(path.join(base, workflowFilename(id)), content, "utf-8");
}

describe("DEFAULT_METHOD", () => {
  it("is the frozen standard method", () => {
    expect(DEFAULT_METHOD).toBe("standard");
  });
});

describe("isValidWorkflowMethodId", () => {
  it("accepts lowercase kebab-case ids", () => {
    for (const id of ["standard", "bug-fix", "client-release", "a1", "x"]) {
      expect(isValidWorkflowMethodId(id)).toBe(true);
    }
  });

  it("rejects hostile, empty, or non-kebab-case ids", () => {
    for (const id of [
      "../escape",
      "a/b",
      "..",
      ".",
      "",
      "UPPER",
      "under_score",
      "trail-",
      "-lead",
      "with space",
    ]) {
      expect(isValidWorkflowMethodId(id)).toBe(false);
    }
  });
});

describe("resolveAdoptedWorkflow", () => {
  it("resolves an adopted workflow from .dooz/workflows/adopted/", async () => {
    const repo = await tmp();
    await adopt(repo, "adopted", "bug-fix");

    const method = await resolveAdoptedWorkflow(repo, "bug-fix");

    expect(method).toMatchObject({ id: "bug-fix", source: "adopted" });
    expect(method.content).toContain("- id: bug-fix");
  });

  it("resolves a project-local workflow from .dooz/workflows/project/", async () => {
    const repo = await tmp();
    await adopt(repo, "project", "client-release");

    const method = await resolveAdoptedWorkflow(repo, "client-release");

    expect(method).toMatchObject({ id: "client-release", source: "project" });
    expect(method.content).toContain("- id: client-release");
  });

  it("resolves deterministically and never guesses between adopted and project", async () => {
    const repo = await tmp();
    await adopt(repo, "adopted", "feature");
    await adopt(repo, "project", "feature");

    await expect(resolveAdoptedWorkflow(repo, "feature")).rejects.toThrow(
      /duplicate workflow method: feature/,
    );
  });

  it("fails loudly when a method is not adopted", async () => {
    const repo = await tmp();
    await adopt(repo, "adopted", "bug-fix");

    await expect(resolveAdoptedWorkflow(repo, "triage")).rejects.toThrow(
      /workflow method not adopted: triage/,
    );
  });

  it("rejects a document whose declared id does not match the requested id", async () => {
    const repo = await tmp();
    await adopt(repo, "adopted", "bug-fix", workflowContent("feature"));

    await expect(resolveAdoptedWorkflow(repo, "bug-fix")).rejects.toThrow(
      /workflow method asset is malformed: bug-fix/,
    );
  });

  it("rejects a document with no Metadata section", async () => {
    const repo = await tmp();
    await adopt(repo, "adopted", "bug-fix", "# Bug Fix\n\nNot a method document.");

    await expect(resolveAdoptedWorkflow(repo, "bug-fix")).rejects.toThrow(
      /workflow method asset is malformed: bug-fix/,
    );
  });

  it("rejects a document whose Metadata section never declares an id", async () => {
    const repo = await tmp();
    await adopt(repo, "adopted", "bug-fix", "# Bug Fix\n\n## Metadata\n\nSome notes.\n");

    await expect(resolveAdoptedWorkflow(repo, "bug-fix")).rejects.toThrow(
      /workflow method asset is malformed: bug-fix/,
    );
  });

  it("rejects a document whose Metadata section is followed by another section without an id", async () => {
    const repo = await tmp();
    await adopt(repo, "adopted", "bug-fix", "# Bug Fix\n\n## Metadata\n\n## Purpose\n\nBody.\n");

    await expect(resolveAdoptedWorkflow(repo, "bug-fix")).rejects.toThrow(
      /workflow method asset is malformed: bug-fix/,
    );
  });

  it("rejects traversal and hostile ids before touching the filesystem", async () => {
    const repo = await tmp();
    await adopt(repo, "adopted", "bug-fix");

    for (const id of ["../escape", "a/b", ".."]) {
      await expect(resolveAdoptedWorkflow(repo, id)).rejects.toThrow(
        /invalid workflow method id: /,
      );
    }
  });

  it("rejects a workflow document that escapes the repository through a symlink", async () => {
    const repo = await tmp();
    const outside = await tmp();
    const target = path.join(outside, "secret.md");
    await writeFile(target, workflowContent("bug-fix"), "utf-8");
    const linkDir = path.join(repo, ".dooz", "workflows", "adopted");
    await mkdir(linkDir, { recursive: true });
    try {
      await symlink(target, path.join(linkDir, "bug-fix.md"));
    } catch {
      // Symlinks are unsupported on this platform; escape is untestable here.
      return;
    }

    await expect(resolveAdoptedWorkflow(repo, "bug-fix")).rejects.toThrow(/escapes sandbox root/);
  });

  it("rejects a workflows directory that is itself a symlink outside the repository", async () => {
    const repo = await tmp();
    const outside = await tmp();
    await mkdir(path.join(outside, "adopted"), { recursive: true });
    await writeFile(
      path.join(outside, "adopted", "bug-fix.md"),
      workflowContent("bug-fix"),
      "utf-8",
    );
    await mkdir(path.join(repo, ".dooz"), { recursive: true });
    try {
      await symlink(
        path.join(outside, "adopted"),
        path.join(repo, ".dooz", "workflows", "adopted"),
      );
    } catch {
      // Symlinks are unsupported on this platform; escape is untestable here.
      return;
    }

    await expect(resolveAdoptedWorkflow(repo, "bug-fix")).rejects.toThrow(/escapes sandbox root/);
  });
});
