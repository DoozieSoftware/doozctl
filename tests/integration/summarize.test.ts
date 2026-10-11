import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { App, type AppDeps } from "../../src/app/app.js";
import { Engine } from "../../src/engine/engine.js";
import {
  builtinMergers,
  DefaultAnalyzer,
  DefaultStandardsLoader,
  DefaultValidator,
} from "../../src/engine/contracts.js";
import { GitService } from "../../src/infra/git/git.js";
import { renderPlan, setPlanStatus } from "../../src/model/plan.js";
import { RepositoryStore } from "../../src/store/repository-store.js";

/**
 * End-to-end summarize tests: append an immutable session summary and rewrite
 * the current context. Sessions are never modified or deleted, and a
 * same-second collision fails instead of overwriting.
 */

const tempDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
});

async function tmp(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

let now = new Date(2026, 7, 9, 9, 30, 0);

beforeEach(() => {
  now = new Date(2026, 7, 9, 9, 30, 0);
});

function buildDeps(print: (message: string) => void = () => {}): AppDeps {
  const git = new GitService();
  return {
    git,
    store: new RepositoryStore(),
    analyzer: new DefaultAnalyzer(git),
    loader: new DefaultStandardsLoader(),
    validator: new DefaultValidator(),
    mergers: builtinMergers(),
    print,
    now: () => now,
  };
}

function app(print: (message: string) => void = () => {}): App {
  return new App(new Engine(), buildDeps(print));
}

/** A repository that the analyzer sees as TypeScript (stable, non-git). */
async function writeRepo(repo: string): Promise<void> {
  await mkdir(path.join(repo, "src"), { recursive: true });
  await writeFile(path.join(repo, "src", "main.ts"), "export {};\n", "utf-8");
}

/** Write a Standards Package declaring session and context artifacts. */
async function writeSummarizePackage(pkg: string): Promise<void> {
  await writeFile(
    path.join(pkg, "package.json"),
    JSON.stringify({
      format: 2,
      name: "@dooziesoft/standards",
      version: "1.0.0",
      engine: ">=1.0.0",
      artifacts: [
        {
          id: "session",
          source: "artifacts/session.md",
          destination: ".ai/sessions/{{session.id}}.md",
          merge: "append",
          lifecycle: ["summarize"],
        },
        {
          id: "current-context",
          source: "artifacts/current-context.md",
          destination: ".ai/current-context.md",
          merge: "overwrite",
          lifecycle: ["summarize"],
        },
      ],
    }),
  );
  await mkdir(path.join(pkg, "artifacts"), { recursive: true });
  await writeFile(
    path.join(pkg, "artifacts", "session.md"),
    [
      "# Session {{session.id}}",
      "",
      "- Date: {{session.date}}",
      "- Tool: {{session.tool}}",
      "- Model: {{session.model}}",
      "- User: {{session.user}}",
      "- Commit: {{session.commit}}",
      "- Branch: {{session.branch}}",
      "- Dirty: {{session.dirty}}",
      "- Source: {{session.source}}",
      "",
      "{{session.baseline}}",
      "",
      "{{session.planContext}}",
      "",
      "{{session.content}}",
    ].join("\n") + "\n",
    "utf-8",
  );
  await writeFile(
    path.join(pkg, "artifacts", "current-context.md"),
    [
      "{{session.contextBaseline}}",
      "# Current Objective",
      "{{session.objective}}",
      "",
      "# Current State",
      "{{session.summary}}",
      "",
      "# Active Decisions",
      "{{session.decisions}}",
      "",
      "# Next Task",
      "{{session.nextSteps}}",
      "",
      "# Open Questions",
      "{{session.openQuestions}}",
    ].join("\n") + "\n",
    "utf-8",
  );
}

async function initSummarize(repo: string, pkg: string): Promise<void> {
  await writeRepo(repo);
  await writeSummarizePackage(pkg);
  const run = app();
  await run.init([repo, pkg]);
}

async function sessionFile(repo: string, content: string): Promise<string> {
  const p = path.join(repo, "pending.md");
  await writeFile(p, content, "utf-8");
  return p;
}

describe("doozctl summarize (integration)", () => {
  it("appends an immutable session and rewrites the current context", async () => {
    const repo = await tmp("doozctl-summary-repo-");
    const pkg = await tmp("doozctl-summary-pkg-");
    await initSummarize(repo, pkg);
    const file = await sessionFile(
      repo,
      [
        "## Objective",
        "Ship the widget.",
        "",
        "## Summary",
        "Built the widget.",
        "",
        "## Decisions",
        "- Use TypeScript.",
        "",
        "## Files Changed",
        "- src/main.ts",
        "",
        "## Next Steps",
        "Review the PR.",
        "",
        "## Open Questions",
        "Who owns the widget?",
      ].join("\n"),
    );

    let printed = "";
    const out = app((message) => (printed += message + "\n"));
    await expect(
      out.summarize([repo, pkg, file, "--tool", "claude", "--model", "opus", "--user", "akshay"]),
    ).resolves.toBe(0);

    expect(printed).toContain("Summarizing repository...");
    expect(printed).toContain("✓ Appended session .ai/sessions/2026-08-09_093000.md");
    expect(printed).toContain("✓ Updated current context");
    expect(printed).toContain("Done.");

    const session = await readFile(
      path.join(repo, ".ai", "sessions", "2026-08-09_093000.md"),
      "utf-8",
    );
    expect(session).toContain("# Session 2026-08-09_093000");
    expect(session).toContain("- Date: 2026-08-09T09:30:00");
    expect(session).toContain("- Tool: claude");
    expect(session).toContain("- Model: opus");
    expect(session).toContain("- User: akshay");
    expect(session).toContain("## Summary");
    expect(session).toContain("Built the widget.");

    const context = await readFile(path.join(repo, ".ai", "current-context.md"), "utf-8");
    expect(context).toContain("# Current Objective\nShip the widget.");
    expect(context).toContain("# Current State\nBuilt the widget.");
    expect(context).toContain("# Active Decisions\n- Use TypeScript.");
    expect(context).toContain("# Next Task\nReview the PR.");
    expect(context).toContain("# Open Questions\nWho owns the widget?");
  });

  it("carries forward objective and open questions from the previous context", async () => {
    const repo = await tmp("doozctl-summary-repo-");
    const pkg = await tmp("doozctl-summary-pkg-");
    await initSummarize(repo, pkg);
    const first = await sessionFile(
      repo,
      "## Objective\nShip the widget.\n\n## Summary\nStarted.\n",
    );
    await app().summarize([repo, pkg, first]);

    now = new Date(2026, 7, 9, 9, 30, 1);
    const second = await sessionFile(
      repo,
      "## Summary\nFinished the widget.\n\n## Open Questions\nWho owns it now?\n",
    );
    await app().summarize([repo, pkg, second]);

    const context = await readFile(path.join(repo, ".ai", "current-context.md"), "utf-8");
    expect(context).toContain("# Current Objective\nShip the widget.");
    expect(context).toContain("# Current State\nFinished the widget.");
    expect(context).toContain("# Open Questions\nWho owns it now?");
  });

  it("fails on a same-second session id collision and never overwrites", async () => {
    const repo = await tmp("doozctl-summary-repo-");
    const pkg = await tmp("doozctl-summary-pkg-");
    await initSummarize(repo, pkg);
    const file = await sessionFile(repo, "## Summary\nfirst\n");
    await app().summarize([repo, pkg, file]);

    const before = await readFile(
      path.join(repo, ".ai", "sessions", "2026-08-09_093000.md"),
      "utf-8",
    );

    const second = await sessionFile(repo, "## Summary\nsecond\n");
    await expect(app().summarize([repo, pkg, second])).rejects.toThrow(
      /session file already exists and is immutable/,
    );

    await expect(
      readFile(path.join(repo, ".ai", "sessions", "2026-08-09_093000.md"), "utf-8"),
    ).resolves.toBe(before);
  });

  it("records commit and branch when the repository is a git repository", async () => {
    const repo = await tmp("doozctl-summary-repo-");
    const pkg = await tmp("doozctl-summary-pkg-");
    await writeRepo(repo);
    await writeSummarizePackage(pkg);

    const { execSync } = await import("node:child_process");
    execSync("git init -q", { cwd: repo, stdio: "ignore" });
    execSync("git add -A", { cwd: repo, stdio: "ignore" });
    execSync('git -c user.email=test@example.com -c user.name=Test commit -q -m "seed"', {
      cwd: repo,
      stdio: "ignore",
    });

    await app().init([repo, pkg]);
    const file = await sessionFile(repo, "## Summary\ncommitted\n");
    await app().summarize([repo, pkg, file]);

    const session = await readFile(
      path.join(repo, ".ai", "sessions", "2026-08-09_093000.md"),
      "utf-8",
    );
    expect(session).toMatch(/- Commit: [0-9a-f]+/);
    expect(session).toMatch(/- Branch: (master|main)\n/);
  });

  it("rejects a missing session file", async () => {
    const repo = await tmp("doozctl-summary-repo-");
    const pkg = await tmp("doozctl-summary-pkg-");
    await initSummarize(repo, pkg);

    await expect(
      app().summarize([repo, pkg, path.join(repo, "does-not-exist.md")]),
    ).rejects.toThrow(/session file not found/);
  });

  it("rejects summarize without a repository, package and session file", async () => {
    await expect(app().summarize([])).rejects.toThrow(/summarize requires a repository path/);
  });

  it("carries provenance and a stale-context qualifier at handover for a STALE plan (A-4)", async () => {
    const repo = await tmp("doozctl-summary-repo-");
    const pkg = await tmp("doozctl-summary-pkg-");
    await writeRepo(repo);
    await writeSummarizePackage(pkg);

    const { execSync } = await import("node:child_process");
    const run = (cmd: string): string => execSync(cmd, { cwd: repo, encoding: "utf8" }).trim();
    run("git init -q");
    run("git add -A");
    run('git -c user.email=test@example.com -c user.name=Test commit -q -m "X"');
    const baseline = run("git rev-parse --short HEAD");

    // An active plan baselined at X, scoped to src/.
    const active = path.join(repo, ".dooz", "plans", "active");
    await mkdir(active, { recursive: true });
    await writeFile(
      path.join(active, "2026-08-13-attendance-punch-sync.md"),
      setPlanStatus(
        renderPlan({ id: "attendance-punch-sync", method: "bug-fix" }, "2026-08-13", {
          commit: baseline,
          branch: "main",
          dirty: "no",
          source: "none",
          ownership: "mixed",
          scopePaths: ["src/"],
        }),
        "EXECUTING",
      ),
      "utf-8",
    );

    // A scoped change at Y makes the plan STALE (S2).
    await writeFile(path.join(repo, "src", "main.ts"), "export const changed = true;\n", "utf-8");
    run("git add -A");
    run('git -c user.email=test@example.com -c user.name=Test commit -q -m "Y"');

    const file = await sessionFile(repo, "## Summary\nhanded over at Y\n");
    const printed: string[] = [];
    const out = app((message) => printed.push(message));
    await out.init([repo, pkg]);
    const code = await out.summarize([repo, pkg, file]);
    expect(code).toBe(0);

    // The handover qualifier is surfaced at summarize time (§13.1).
    expect(printed.join("\n")).toContain(
      "⚠ Plan 'attendance-punch-sync' context is STALE — re-understand the described scope before continuing:",
    );
    expect(printed.join("\n")).toContain("src/main.ts changed since baseline");

    // The session record carries its own baseline block, labeled by its
    // plan source, with the plan's scope paths inherited (A-6).
    const session = await readFile(
      path.join(repo, ".ai", "sessions", "2026-08-09_093000.md"),
      "utf-8",
    );
    expect(session).toContain("## Baseline");
    expect(session).toContain("- commit: ");
    // init wrote .ai/ files after commit Y, so the handover itself is a dirty
    // observation — the qualifier is recorded faithfully, never hidden.
    expect(session).toContain("- Dirty: yes");
    expect(session).toContain("- source: plan:attendance-punch-sync");
    expect(session).toContain("- scope-path: src/");
    expect(session).toContain(
      "Known stale context: plan 'attendance-punch-sync' is STALE — re-understand the described scope before continuing.",
    );

    // current-context carries the machine block labeled by its session source.
    const context = await readFile(path.join(repo, ".ai", "current-context.md"), "utf-8");
    expect(context.startsWith("## Baseline")).toBe(true);
    expect(context).toContain("- source: session:2026-08-09_093000");
    expect(context).toContain("- scope-path: src/");
  });

  it("keeps handover unqualified for a CURRENT plan and emits no provenance outside git", async () => {
    const repo = await tmp("doozctl-summary-repo-");
    const pkg = await tmp("doozctl-summary-pkg-");
    await writeRepo(repo);
    await writeSummarizePackage(pkg);

    const { execSync } = await import("node:child_process");
    const run = (cmd: string): string => execSync(cmd, { cwd: repo, encoding: "utf8" }).trim();
    run("git init -q");
    run("git add -A");
    run('git -c user.email=test@example.com -c user.name=Test commit -q -m "X"');
    const baseline = run("git rev-parse --short HEAD");

    // A plan baselined at the tip (CURRENT/TRUSTED — no scoped change since).
    const active = path.join(repo, ".dooz", "plans", "active");
    await mkdir(active, { recursive: true });
    await writeFile(
      path.join(active, "2026-08-13-attendance-punch-sync.md"),
      renderPlan({ id: "attendance-punch-sync", method: "bug-fix" }, "2026-08-13", {
        commit: baseline,
        branch: "main",
        dirty: "no",
        source: "none",
        ownership: "mixed",
        scopePaths: ["src/"],
      }),
      "utf-8",
    );

    const file = await sessionFile(repo, "## Summary\nhanded over at tip\n");
    const printed: string[] = [];
    const out = app((message) => printed.push(message));
    await out.init([repo, pkg]);
    await out.summarize([repo, pkg, file]);
    expect(printed.join("\n")).not.toContain("STALE");

    const session = await readFile(
      path.join(repo, ".ai", "sessions", "2026-08-09_093000.md"),
      "utf-8",
    );
    expect(session).toContain("## Baseline");
    expect(session).toContain("- source: plan:attendance-punch-sync");
    expect(session).not.toContain("Known stale context");

    // A gitless summarize (pkg without the plan) emits no baseline block and
    // no warning — the artifacts stay baseline-less, never INVALID.
    const bare = await tmp("doozctl-summary-bare-");
    await writeRepo(bare);
    const bareFile = await sessionFile(bare, "## Summary\nno git\n");
    await app().init([bare, pkg]);
    await app().summarize([bare, pkg, bareFile]);
    const bareSession = await readFile(
      path.join(bare, ".ai", "sessions", "2026-08-09_093000.md"),
      "utf-8",
    );
    expect(bareSession).not.toContain("## Baseline");
    const bareContext = await readFile(path.join(bare, ".ai", "current-context.md"), "utf-8");
    expect(bareContext.startsWith("## Baseline")).toBe(false);
  });
});
