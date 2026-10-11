import { Writable } from "node:stream";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { App, type AppDeps } from "../../src/app/app.js";
import { runCli } from "../../src/cli/cli.js";
import { Dispatcher } from "../../src/dispatcher/dispatcher.js";
import { Engine } from "../../src/engine/engine.js";
import {
  builtinMergers,
  DefaultAnalyzer,
  DefaultStandardsLoader,
  DefaultValidator,
} from "../../src/engine/contracts.js";
import { GitService } from "../../src/infra/git/git.js";
import { planFilename, renderPlan, setPlanStatus } from "../../src/model/plan.js";
import { RepositoryStore } from "../../src/store/repository-store.js";

/**
 * V3-P12 — Multi-agent gauntlet.
 *
 * Automated checks per GAUNTLET-SPEC.md (Scenarios A/B/C of CONTEXT-SPEC §19)
 * for the composition of P04–P11. "Agents" are sequential CLI invocations in
 * one temp repository; the durable residue of an agent act (plan, session,
 * current-context) is exactly what v3 evaluates. Tests-only by contract.
 *
 * Assertions follow the spec's stable-token rule: row states, exit codes,
 * steady substrings and byte equality — never golden prose.
 *
 * Escalated to P13/P14 (contract gaps, not patched in P12 per GAUNTLET-SPEC
 * §2):
 *  - N-4 (scope-cycle detection) is NOT automated: the engine evaluates each
 *    artifact's own `## Baseline` scope and does not resolve `source:` links
 *    at evaluation time (inheritance is realized by P11 carry-forward into the
 *    child baseline). The §9.2 cycle guard needs an evaluation-time chain
 *    walk that P12's tests-only contract deliberately does not add.
 *  - C-5 (`pnpm check` green with the suite present) is the runner's gate, not
 *    an in-suite assertion; it is executed manually after this file lands.
 */

const PINNED_GIT_DATE = "2026-08-09T09:00:00Z";
const PLAN_ID = "attendance-punch-sync";
const PLAN_FILENAME = planFilename("2026-08-09", PLAN_ID);
const WORKFLOW_ID = "feature";
const SESSION_A = "2026-08-09_093000";

const tempDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
});

async function tmp(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

/** Harness-advanced frozen clock (H-3): session ids replay deterministically. */
let now = new Date(2026, 7, 9, 9, 30, 0);

beforeEach(() => {
  now = new Date(2026, 7, 9, 9, 30, 0);
function buildDeps(print: (message: string) => void): AppDeps {
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

function buildDispatcher(print: (message: string) => void): Dispatcher {
  const app = new App(new Engine(), buildDeps(print));
  return new Dispatcher()
    .register("init", app.init.bind(app))
    .register("analyze", app.analyze.bind(app))
    .register("sync", app.sync.bind(app))
    .register("doctor", app.doctor.bind(app))
    .register("summarize", app.summarize.bind(app))
    .register("status", app.status.bind(app))
    .register("plan", app.plan.bind(app))
    .register("verify", app.verify.bind(app))
    .register("context validate", app.contextValidate.bind(app));
}

/** Run the CLI and capture app output + stdout/stderr + exit code. */
async function run(
  repo: string,
  argv: string[],
): Promise<{ code: number; out: string; err: string }> {
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
  const code = await runCli(argv, buildDispatcher((message) => (outBuf += message + "\n")), {
    stdout,
    stderr,
  });
  return { code, out: outBuf, err: errBuf };
}

/** H-4: analyze-refresh the generated artifact, then run the command. */
async function evaluate(
  repo: string,
  args: string[],
): Promise<{ code: number; out: string; err: string }> {
  await run(repo, ["analyze", repo]);
  return run(repo, [...args, repo]);
}

/** H-2: git plumbing helper (read-only). */
function git(repo: string, args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
}

/** H-2: add-commit with pinned dates so replays are byte-stable. */
function commit(repo: string, message: string): void {
  git(repo, ["add", "-A"]);
  execFileSync(
    "git",
    [
      "-c",
      "user.email=agent@dooz.test",
      "-c",
      "user.name=Gauntlet Agent",
      "commit",
      "-q",
      "-m",
      message,
    ],
    {
      cwd: repo,
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: PINNED_GIT_DATE,
        GIT_COMMITTER_DATE: PINNED_GIT_DATE,
      },
    },
  );
}

/** H-5: pre/post state = HEAD + porcelain + byte-identity of .ai and .dooz. */
async function repoState(repo: string): Promise<string> {
  const parts = [git(repo, ["rev-parse", "HEAD"]), git(repo, ["status", "--porcelain"])];
  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(path.join(repo, dir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(child);
      } else {
        parts.push(`${child}:${await readFile(path.join(repo, child), "utf-8")}`);
      }
    }
  };
  await walk(".ai");
  await walk(".dooz");
  return parts.join("\n");
}
/** FIX-1: source files for feature F and unrelated area U. */
async function writeFixture(repo: string): Promise<void> {
  await mkdir(path.join(repo, "src/attendance"), { recursive: true });
  await mkdir(path.join(repo, "tests/attendance"), { recursive: true });
  await mkdir(path.join(repo, "src/billing"), { recursive: true });
  await writeFile(path.join(repo, "src/attendance/PunchService.ts"), "export const I = 1;\n");
  await writeFile(
    path.join(repo, "tests/attendance/PunchService.test.ts"),
    'import { expect, it } from "vitest";\nit("punches", () => expect(1).toBe(1));\n',
  );
  await writeFile(path.join(repo, "src/billing/Invoice.ts"), "export const I = 2;\n");
  await writeFile(path.join(repo, "src/billing/Invoice.test.ts"), "// invoice tests\n");
}

/** FIX-1 package: session + current-context artifacts with P11 templates. */
async function writeSummarizePackage(pkg: string): Promise<void> {
  await mkdir(path.join(pkg, "artifacts"), { recursive: true });
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
  await writeFile(
    path.join(pkg, "artifacts", "session.md"),
    [
      "# Session {{session.id}}",
      "",
      "- Date: {{session.date}}",
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
      "# Open Questions",
      "{{session.openQuestions}}",
    ].join("\n") + "\n",
  );
}

/** The adopted `feature` workflow (FIX-1): recorded + commit evidence. */
async function adoptFeatureWorkflow(repo: string): Promise<void> {
  const dir = path.join(repo, ".dooz", "workflows", "adopted");
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, `${WORKFLOW_ID}.md`),
    [
      `# ${WORKFLOW_ID}`,
      "",
      "## Metadata",
      "",
      `- id: ${WORKFLOW_ID}`,
      "",
      "## Required Evidence",
      "",
      "- [ ] acceptance-criteria",
      "- [ ] tests",
      "- [ ] verification",
      "- [ ] commit",
    ].join("\n"),
  );
}

/** The session content Agent A leaves behind (six documented sections). */
const SESSION_CONTENT = [
  "## Objective",
  "Ship attendance punch sync.",
  "",
  "## Summary",
  "Stubbed attendance records.",
  "",
  "## Decisions",
  "- Record punches client-side.",
  "",
  "## Files Changed",
  "- src/attendance/PunchService.ts",
  "",
  "## Next Steps",
  "Implement punch recording.",
  "",
  "## Open Questions",
  "Who owns test data?",
].join("\n");
/**
 * CA — Agent A's stage (GAUNTLET-SPEC): plan at C1, then author the agent's
 * intent (scope + evidence + `## Commit` = C1), transition to EXECUTING,
 * summarize a session + current-context, and commit the whole context delta
 * at X. Returns the repo, the C1 short hash, the plan path and A's immutable
 * session path.
 */
async function buildGreenBaseline(): Promise<{
  repo: string;
  c1: string;
  c1Full: string;
  planPath: string;
  sessionPath: string;
  pkg: string;
}> {
  const repo = await tmp("doozctl-gauntlet-repo-");
  const pkg = await tmp("doozctl-gauntlet-pkg-");

  await writeFixture(repo);
  await writeSummarizePackage(pkg);
  await adoptFeatureWorkflow(repo);

  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["config", "user.email", "agent@dooz.test"]);
  git(repo, ["config", "user.name", "Gauntlet Agent"]);
  commit(repo, "c0: source tree");

  // C1 — control plane: init writes the manifest + repository analysis.
  const init = await run(repo, ["init", repo, pkg]);
  if (init.code !== 0) {
    throw new Error(`gauntlet init failed: ${init.err}${init.out}`);
  }
  commit(repo, "c1: control plane");
  const c1 = git(repo, ["rev-parse", "--short", "HEAD"]);
  const c1Full = git(repo, ["rev-parse", "HEAD"]);

  await run(repo, ["plan", repo, "--method", WORKFLOW_ID, "--title", PLAN_ID]);
  const planPath = path.join(repo, ".dooz", "plans", "active", PLAN_FILENAME);
  const authored = authorPlan(await readFile(planPath, "utf-8"), c1);
  await writeFile(planPath, authored, "utf-8");

  await summarize(repo, pkg, SESSION_CONTENT);

  commit(repo, "x: agent a context");
  return {
    repo,
    c1,
    c1Full,
    planPath,
    sessionPath: path.join(repo, ".ai", "sessions", `${SESSION_A}.md`),
    pkg,
  };
}

/** The agent's authored edits to the rendered plan (GAUNTLET CA step 2/3). */
function authorPlan(content: string, c1: string): string {
  const out = content
    .replace(
      "- ownership: mixed",
      "- ownership: mixed\n- scope-path: src/attendance/\n- scope-path: tests/attendance/",
    )
    .replace(
      "## Acceptance Criteria\n\n## Plan",
      "## Acceptance Criteria\n\n- Punch sync recorded in UTC.\n\n## Plan",
    )
    .replace(
      "## Verification\n\n## Test Evidence",
      "## Verification\n\ntypecheck passed; lint passed\n\n## Test Evidence",
    )
    .replace(
      "## Test Evidence\n\n## Decisions",
      "## Test Evidence\n\n19 tests / 38 assertions passed\n\n## Decisions",
    )
    .replace(
      "## Commit\n\n## Next Action",
      `## Commit\n\n${c1} on main\n\n## Next Action`,
    );
  return setPlanStatus(out, "EXECUTING");
}

/** H-3: write a session file and summarize it (append + overwrite). */
async function summarize(repo: string, pkg: string, content: string): Promise<void> {
  const file = path.join(repo, "pending.md");
  await writeFile(file, content, "utf-8");
  const result = await run(repo, ["summarize", repo, pkg, file]);
  if (result.code !== 0) {
    throw new Error(`gauntlet summarize failed: ${result.err}${result.out}`);
  }
}
describe("gauntlet: scenario A — a relevant change must be detected", () => {
  it("A-0 — the green baseline at X is fully CURRENT with exit 0", async () => {
    const { repo } = await buildGreenBaseline();

    const v = await evaluate(repo, ["context", "validate"]);
    expect(v.code).toBe(0);
    expect(v.out).toContain("✓ repository-analysis.json — TRUSTED");
    expect(v.out).toContain(`✓ plans/active/${PLAN_FILENAME} — TRUSTED`);
    expect(v.out).toContain(`✓ sessions/${SESSION_A}.md — TRUSTED`);
    expect(v.out).toContain("✓ current-context.md — TRUSTED");
    // §6.3: every scoped artifact under the moved-but-empty diff carries the
    // outside-scope note; the analysis control row (refreshed at X) is plain.
    expect(v.out).toContain("    repository moved outside described scope");
    expect(v.out).toContain("Result: 0 stale, 0 unknown, 0 invalid");

    const s = await run(repo, ["status", repo]);
    expect(s.code).toBe(0);
    expect(s.out).toContain("Stale     0");
    expect(s.out).not.toContain("Context: STALE");
  });

  it("A-1/A-2 — an in-scope change makes the plan, session and current-context STALE", async () => {
    const { repo } = await buildGreenBaseline();

    // Agent B changes feature F (src/attendance) — an in-scope commit Y.
    await writeFile(path.join(repo, "src/attendance/PunchService.ts"), "export const changed = 1;\n");
    commit(repo, "y: in-scope change");

    const v = await evaluate(repo, ["context", "validate"]);
    expect(v.code).toBe(1);
    expect(v.out).toContain(`⚠ plans/active/${PLAN_FILENAME} — STALE`);
    expect(v.out).toContain(`⚠ sessions/${SESSION_A}.md — STALE`);
    expect(v.out).toContain("⚠ current-context.md — STALE");
    expect(v.out).toContain("✓ repository-analysis.json — TRUSTED");
    expect(v.out).toContain("src/attendance/PunchService.ts changed since baseline ");
    // Exactly three stale context rows, no spurious rows, control row CURRENT.
    expect(v.out).toContain("Result: 3 stale, 0 unknown, 0 invalid");

    // AS-7: the status surface carries the §12 drift observation.
    const s = await run(repo, ["status", repo]);
    expect(s.out).toContain("Context: STALE");
    expect(s.out).toContain("Re-understand the described scope before continuing.");
    expect(s.out).toContain("src/attendance/PunchService.ts changed since baseline ");
    expect(s.out).toContain("Stale     3");
  });

  it("A-3 — verify demotes recorded evidence to STALE-BASELINE under the STALE plan", async () => {
    const { repo } = await buildGreenBaseline();

    await writeFile(path.join(repo, "src/attendance/PunchService.ts"), "export const changed = 1;\n");
    commit(repo, "y: in-scope change");

    const ver = await evaluate(repo, ["verify"]);
    // AS-4: recorded rows demote via §11.2 rule 2; presence alone gates the
    // exit (P10 settled READY/NOT READY as annotation-only), so verify exits 0.
    expect(ver.code).toBe(0);
    expect(ver.out).toContain("Acceptance criteria   ✓ (STALE-BASELINE)");
    expect(ver.out).toContain("Verification          ✓ (STALE-BASELINE)");
    expect(ver.out).toContain("Tests                 ");
    expect(ver.out).toContain("(STALE-BASELINE)");
    // S4: the plan's `## Commit` = C1 is reachable from Y but != Y.
    expect(ver.out).toContain("Commit                ✓ (recorded, not current)");
    // AS-7: the §12 drift observation is present in the verify report.
    expect(ver.out).toContain("Context: STALE");
    expect(ver.out).toContain("src/attendance/PunchService.ts changed since baseline ");
  });

  it("A-4 — Agent C's handover re-grounds C, never A", async () => {
    const { repo, pkg, sessionPath } = await buildGreenBaseline();

    await writeFile(path.join(repo, "src/attendance/PunchService.ts"), "export const changed = 1;\n");
    commit(repo, "y: in-scope change");
    const aSessionBefore = await readFile(sessionPath, "utf-8");

    // Agent C summarizes at Y; the clock advances so C's session id differs.
    now = new Date(2026, 7, 9, 9, 30, 1);
    await summarize(
      repo,
      pkg,
      ["## Summary", "C picked up the baton at Y.", "", "## Next Steps", "Finish punch recording."].join("\n"),
    );
    // A's immutable session is byte-identical and still stale.
    expect(await readFile(sessionPath, "utf-8")).toBe(aSessionBefore);
    expect(await readFile(path.join(repo, ".ai", "sessions", "2026-08-09_093001.md"), "utf-8")).toContain(
      "C picked up the baton at Y.",
    );

    const v = await evaluate(repo, ["context", "validate"]);
    expect(v.code).toBe(1);
    expect(v.out).toContain(`⚠ plans/active/${PLAN_FILENAME} — STALE`);
    expect(v.out).toContain(`⚠ sessions/${SESSION_A}.md — STALE`);
    expect(v.out).toContain("✓ sessions/2026-08-09_093001.md — TRUSTED");
    expect(v.out).toContain("✓ current-context.md — TRUSTED");
    expect(v.out).toContain("Result: 2 stale, 0 unknown, 0 invalid");
  });

  it("A-5 — read-only commands never write at the A-1 problem state", async () => {
    const { repo } = await buildGreenBaseline();

    await writeFile(path.join(repo, "src/attendance/PunchService.ts"), "export const changed = 1;\n");
    commit(repo, "y: in-scope change");
    await evaluate(repo, ["context", "validate"]); // analyze refresh + settle

    for (const args of [
      ["context", "validate"],
      ["status"],
      ["verify"],
    ]) {
      const before = await repoState(repo);
      const result = await run(repo, [...args, repo]);
      const after = await repoState(repo);
      expect(after).toBe(before);
      expect(result.code).toBeGreaterThanOrEqual(0);
    }
  });
});
describe("gauntlet: scenario B — an unrelated change must NOT over-flag", () => {
  it("B-0/B-1 — an out-of-scope change keeps every context row CURRENT with exit 0", async () => {
    const { repo } = await buildGreenBaseline();

    // Agent B changes the unrelated area U (src/billing) at Y.
    await writeFile(path.join(repo, "src/billing/Invoice.ts"), "export const changed = 2;\n");
    commit(repo, "y: unrelated change");

    const v = await evaluate(repo, ["context", "validate"]);
    expect(v.code).toBe(0);
    expect(v.out).toContain("✓ repository-analysis.json — TRUSTED");
    expect(v.out).toContain(`✓ plans/active/${PLAN_FILENAME} — TRUSTED`);
    expect(v.out).toContain(`✓ sessions/${SESSION_A}.md — TRUSTED`);
    expect(v.out).toContain("✓ current-context.md — TRUSTED");
    // AS-3: CURRENT under a moved tip carries the §6.3 note.
    expect(v.out).toContain("    repository moved outside described scope");
    expect(v.out).toContain("Result: 0 stale, 0 unknown, 0 invalid");
  });

  it("B-2 — verify shows no demotion for a CURRENT plan", async () => {
    const { repo } = await buildGreenBaseline();

    await writeFile(path.join(repo, "src/billing/Invoice.ts"), "export const changed = 2;\n");
    commit(repo, "y: unrelated change");

    const ver = await evaluate(repo, ["verify"]);
    expect(ver.code).toBe(0);
    expect(ver.out).not.toContain("STALE-BASELINE");
    expect(ver.out).toContain("Acceptance criteria   ✓ (recorded, not verified against HEAD)");
    expect(ver.out).toContain("Tests                 ");
    expect(ver.out).toContain("(recorded, not verified against HEAD)");
    // The `## Commit` = C1 row is reachable but not the tip: honest S4.
    expect(ver.out).toContain("Commit                ✓ (recorded, not current)");
  });

  it("B-3 — status stays clean for the out-of-scope move, with no drift", async () => {
    const { repo } = await buildGreenBaseline();

    await writeFile(path.join(repo, "src/billing/Invoice.ts"), "export const changed = 2;\n");
    commit(repo, "y: unrelated change");

    await evaluate(repo, ["status"]);
    const s = await run(repo, ["status", repo]);
    expect(s.code).toBe(0);
    expect(s.out).toContain("Stale     0");
    expect(s.out).not.toContain("Context: STALE");
    expect(s.out).not.toContain("Re-understand the described scope");
  });
});

describe("gauntlet: scenario C — determinism and safety", () => {
  it("C-1 — repeated commands are byte-identical on A-1 and B-1 states", async () => {
    const states: Array<"in" | "out"> = ["in", "out"];
    for (const kind of states) {
      const { repo } = await buildGreenBaseline();
      const target = path.join(
        repo,
        kind === "in" ? "src/attendance/PunchService.ts" : "src/billing/Invoice.ts",
      );
      await writeFile(target, kind === "in" ? "export const changed = 1;\n" : "export const changed = 2;\n");
      commit(repo, `y: ${kind}-scope change`);
      await evaluate(repo, ["context", "validate"]); // settle + refresh analysis

      for (const args of [
        ["context", "validate"],
        ["status"],
        ["verify"],
      ]) {
        const first = await run(repo, [...args, repo]);
        const second = await run(repo, [...args, repo]);
        expect(second.out).toBe(first.out);
        expect(second.code).toBe(first.code);
      }
    }
  });

  it("C-2 — no read-only command writes at the A-1 state (AS-5 repeats on all three)", async () => {
    const { repo } = await buildGreenBaseline();

    await writeFile(path.join(repo, "src/attendance/PunchService.ts"), "export const changed = 1;\n");
    commit(repo, "y: in-scope change");
    await evaluate(repo, ["context", "validate"]);

    const before = await repoState(repo);
    await run(repo, ["context", "validate", repo]);
    await run(repo, ["status", repo]);
    await run(repo, ["verify", repo]);
    const after = await repoState(repo);
    expect(after).toBe(before);
  });
it("C-3 — pre-v3 artifacts report UNKNOWN, never INVALID, with exit 0", async () => {
    const repo = await tmp("doozctl-gauntlet-legacy-");
    const pkg = await tmp("doozctl-gauntlet-pkg-");
    await writeFixture(repo);
    await writeSummarizePackage(pkg);
    await adoptFeatureWorkflow(repo);

    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["config", "user.email", "agent@dooz.test"]);
    git(repo, ["config", "user.name", "Gauntlet Agent"]);
    commit(repo, "c0: source tree");
    await run(repo, ["init", repo, pkg]);

    // Pre-v3 artifacts: no `git.commit`, no `## Baseline` blocks anywhere.
    await writeFile(
      path.join(repo, ".ai", "repository-analysis.json"),
      JSON.stringify({
        root: repo,
        git: { isRepository: true, branch: "main", dirty: false },
        languages: ["TypeScript"],
        frameworks: [],
        buildSystem: null,
        packageManager: null,
        testFramework: null,
        ci: [],
        docker: false,
        statistics: { totalFiles: 4, sourceFiles: 4, testFiles: 0 },
      }),
    );
    await mkdir(path.join(repo, ".ai", "sessions"), { recursive: true });
    await writeFile(
      path.join(repo, ".ai", "sessions", "2026-08-09_000000.md"),
      "# Session 2026-08-09_000000\n\n## Summary\nLegacy work.\n",
    );
    await writeFile(path.join(repo, ".ai", "current-context.md"), "# Current Objective\nOld goal.\n");
    await mkdir(path.join(repo, ".dooz", "plans", "active"), { recursive: true });
    await writeFile(
      path.join(repo, ".dooz", "plans", "active", planFilename("2026-08-09", "legacy")),
      renderPlan({ id: "legacy", method: "feature" }, "2026-08-13"),
    );

    const v = await run(repo, ["context", "validate", repo]);
    expect(v.code).toBe(0);
    expect(v.out).toContain("? repository-analysis.json — UNKNOWN");
    expect(v.out).toContain("? plans/active/2026-08-09-legacy.md — UNKNOWN");
    expect(v.out).toContain("? sessions/2026-08-09_000000.md — UNKNOWN");
    expect(v.out).toContain("? current-context.md — UNKNOWN");
    expect(v.out).not.toContain("— INVALID");
    expect(v.out).toContain("Result: 0 stale, 4 unknown, 0 invalid");

    const s = await run(repo, ["status", repo]);
    expect(s.code).toBe(0);
    expect(s.out).toContain("Unknown   4");
    expect(s.out).not.toContain("  Invalid");
  });

  it("C-4 — unreachable and malformed baselines report INVALID with exit 1", async () => {
    const { repo: aRepo } = await buildUnreachableBaselineRepo();
    const a = await evaluate(aRepo, ["context", "validate"]);
    expect(a.code).toBe(1);
    expect(a.out).toContain("— INVALID");
    expect(a.out).toContain("cannot be resolved");

    const { repo: bRepo } = await buildMalformedBaselineRepo();
    const b = await evaluate(bRepo, ["context", "validate"]);
    expect(b.code).toBe(1);
    expect(b.out).toContain("— INVALID");
    expect(b.out).toContain("invalid baseline dirty value: maybe");
  });
});
/**
 * T-6 state: the branch is rebuilt as an orphan after the context was created,
 * so the artifact baselines (short hashes of the pre-rewrite commits) become
 * unresolvable — history was rewritten behind the artifacts.
 */
async function buildUnreachableBaselineRepo(): Promise<{ repo: string; planPath: string }> {
  const repo = await tmp("doozctl-gauntlet-t6-");
  const pkg = await tmp("doozctl-gauntlet-pkg-");
  await writeFixture(repo);
  await writeSummarizePackage(pkg);
  await adoptFeatureWorkflow(repo);
  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["config", "user.email", "agent@dooz.test"]);
  git(repo, ["config", "user.name", "Gauntlet Agent"]);
  commit(repo, "c0: source tree");
  await run(repo, ["init", repo, pkg]);
  commit(repo, "c1: control plane");
  const baselineCommit = git(repo, ["rev-parse", "--short", "HEAD"]);

  await run(repo, ["plan", repo, "--method", WORKFLOW_ID, "--title", PLAN_ID]);
  const planPath = path.join(repo, ".dooz", "plans", "active", PLAN_FILENAME);
  await writeFile(planPath, authorPlan(await readFile(planPath, "utf-8"), baselineCommit), "utf-8");
  commit(repo, "x: context");

  // History rewrite: orphan commit carries the same tree, then the old
  // commits and their reflog entries are pruned, making the baselines
  // unresolvable (context files remain present).
  git(repo, ["checkout", "-q", "--orphan", "ghost"]);
  git(repo, ["add", "-A"]);
  git(repo, ["-c", "user.email=agent@dooz.test", "-c", "user.name=Gauntlet Agent", "commit", "-q", "-m", "rewrite"]);
  git(repo, ["branch", "-M", "ghost", "main"]);
  git(repo, ["reflog", "expire", "--expire=now", "--all"]);
  git(repo, ["gc", "--prune=now"]);

  // The pre-rewrite hashes must be pruned.
  expect(git(repo, ["rev-parse", "--verify", baselineCommit])).toMatch(/^fatal/);
  return { repo, planPath };
}

/** T-7 state: a plan whose `## Baseline` breaks the grammar. */
async function buildMalformedBaselineRepo(): Promise<{ repo: string }> {
  const repo = await tmp("doozctl-gauntlet-t7-");
  const pkg = await tmp("doozctl-gauntlet-pkg-");
  await writeFixture(repo);
  await writeSummarizePackage(pkg);
  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["config", "user.email", "agent@dooz.test"]);
  git(repo, ["config", "user.name", "Gauntlet Agent"]);
  commit(repo, "c0: source tree");
  await run(repo, ["init", repo, pkg]);

  const active = path.join(repo, ".dooz", "plans", "active");
  await mkdir(active, { recursive: true });
  const malformed = [
    "# malformed",
    "",
    "## Metadata",
    "",
    "- id: malformed",
    "- method: feature",
    "- status: PLANNED",
    "- created: 2026-08-09",
    "",
    "## Baseline",
    "",
    "- commit: abc123",
    "- branch: main",
    "- dirty: maybe",
    "",
    "## Objective",
    "",
  ].join("\n");
  await writeFile(path.join(active, planFilename("2026-08-09", "malformed")), malformed, "utf-8");
  return { repo };
}

/**
 * T-1 state: an unscoped plan under an unrelated commit move. Documents the
 * conservative default: an unscoped artifact is STALE on ANY commit move.
 */
async function buildUnscopedBaselineRepo(): Promise<{ repo: string }> {
  const repo = await tmp("doozctl-gauntlet-t1-");
  const pkg = await tmp("doozctl-gauntlet-pkg-");
  await writeFixture(repo);
  await writeSummarizePackage(pkg);
  await adoptFeatureWorkflow(repo);
  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["config", "user.email", "agent@dooz.test"]);
  git(repo, ["config", "user.name", "Gauntlet Agent"]);
  commit(repo, "c0: source tree");
  await run(repo, ["init", repo, pkg]);
  commit(repo, "c1: control plane");

  // A plan created via the `plan` command carries a baseline but no scope
  // (captureBaseline does not declare scope) — the conservative path.
  await run(repo, ["plan", repo, "--method", WORKFLOW_ID, "--title", PLAN_ID]);
  commit(repo, "x: context");
  return { repo };
}
describe("gauntlet: T-checks — trust-state and signal coverage", () => {
  it("T-1 — an unscoped plan is conservatively STALE on an unrelated commit move", async () => {
    const { repo } = await buildUnscopedBaselineRepo();

    await writeFile(path.join(repo, "src/billing/Invoice.ts"), "export const changed = 2;\n");
    commit(repo, "y: unrelated change");

    const v = await evaluate(repo, ["context", "validate"]);
    expect(v.code).toBe(1);
    expect(v.out).toContain(`⚠ plans/active/${PLAN_FILENAME} — STALE`);
    expect(v.out).toContain("repository moved since baseline ");
    expect(v.out).toContain("Result: 1 stale, 0 unknown, 0 invalid");
  });

  it("T-4 — a scoped path deleted at HEAD makes the plan STALE", async () => {
    const { repo } = await buildGreenBaseline();

    await rm(path.join(repo, "src/attendance/PunchService.ts"));
    commit(repo, "y: delete scoped path");

    const v = await evaluate(repo, ["context", "validate"]);
    expect(v.code).toBe(1);
    expect(v.out).toContain(`⚠ plans/active/${PLAN_FILENAME} — STALE`);
    // The changed (deleted) path is named by the scoped diff.
    expect(v.out).toContain("src/attendance/PunchService.ts");
    expect(v.out).toContain("changed since baseline ");
  });

  it("T-6 — an unreachable baseline is INVALID", async () => {
    const { repo } = await buildUnreachableBaselineRepo();

    const v = await evaluate(repo, ["context", "validate"]);
    expect(v.code).toBe(1);
    expect(v.out).toContain(`✗ plans/active/${PLAN_FILENAME} — INVALID`);
    expect(v.out).toContain("cannot be resolved in this repository");
  });

  it("T-7 — a malformed baseline is INVALID", async () => {
    const { repo } = await buildMalformedBaselineRepo();

    const v = await evaluate(repo, ["context", "validate"]);
    expect(v.code).toBe(1);
    expect(v.out).toContain("✗ plans/active/2026-08-09-malformed.md — INVALID");
    expect(v.out).toContain("invalid baseline dirty value: maybe; expected yes or no");
  });

  it("T-8 — a completed plan under an in-scope change stays STALE (terminal, unreconcilable)", async () => {
    const { repo } = await buildGreenBaseline();

    // Move the plan to the completed directory.
    const completed = path.join(repo, ".dooz", "plans", "completed");
    await mkdir(completed, { recursive: true });
    const moved = await readFile(path.join(repo, ".dooz", "plans", "active", PLAN_FILENAME), "utf-8");
    await writeFile(path.join(completed, PLAN_FILENAME), setPlanStatus(moved, "COMPLETED"), "utf-8");
    await rm(path.join(repo, ".dooz", "plans", "active", PLAN_FILENAME));
    commit(repo, "x: plan completed");

    await writeFile(path.join(repo, "src/attendance/PunchService.ts"), "export const changed = 1;\n");
    commit(repo, "y: in-scope change");

    const v = await evaluate(repo, ["context", "validate"]);
    expect(v.code).toBe(1);
    expect(v.out).toContain(`⚠ plans/completed/${PLAN_FILENAME} — STALE`);
    expect(v.out).toContain("src/attendance/PunchService.ts changed since baseline ");
  });
});

describe("gauntlet: N-guards — signals that must NOT over-flag", () => {
  it("N-1 — an uncommitted scoped change is not staleness", async () => {
    const { repo } = await buildGreenBaseline();

    // Agent B edits feature F but never commits.
    await writeFile(path.join(repo, "src/attendance/PunchService.ts"), "export const changed = 1;\n");

    // Without a commit there is no HEAD move; signals are commit-grounded.
    const v = await evaluate(repo, ["context", "validate"]);
    expect(v.code).toBe(0);
    expect(v.out).toContain("Stale     0");
    expect(v.out).not.toContain("Context: STALE");
  });

  it("N-2 — a branch rename is not staleness", async () => {
    const { repo } = await buildGreenBaseline();

    // Rename the branch at an unchanged HEAD; the commit hash is unchanged.
    git(repo, ["branch", "-m", "main", "trunk"]);

    const v = await evaluate(repo, ["context", "validate"]);
    expect(v.code).toBe(0);
    expect(v.out).toContain("Stale     0");
  });

  it("N-3 — a workflow-method change is not staleness", async () => {
    const { repo } = await buildGreenBaseline();

    // Edit the adopted workflow's prose; methods are the governance axis,
    // never staleness-checked (§4 rule 1, D4).
    const workflow = path.join(repo, ".dooz", "workflows", "adopted", WORKFLOW_ID + ".md");
    await writeFile(workflow, (await readFile(workflow, "utf-8")) + "\n\n## Notes\nGovernance prose.\n");
    commit(repo, "y: workflow prose change");

    const v = await evaluate(repo, ["context", "validate"]);
    expect(v.code).toBe(0);
    expect(v.out).toContain("Stale     0");
  });

  it("N-5 — authored content and baselines are never rewritten by read-only commands", async () => {
    const { repo, planPath, sessionPath } = await buildGreenBaseline();

    await writeFile(path.join(repo, "src/attendance/PunchService.ts"), "export const changed = 1;\n");
    commit(repo, "y: in-scope change");
    await evaluate(repo, ["context", "validate"]);

    const planBefore = await readFile(planPath, "utf-8");
    const sessionBefore = await readFile(sessionPath, "utf-8");
    const currentContextBefore = await readFile(path.join(repo, ".ai", "current-context.md"), "utf-8");

    await run(repo, ["context", "validate", repo]);
    await run(repo, ["status", repo]);
    await run(repo, ["verify", repo]);

    expect(await readFile(planPath, "utf-8")).toBe(planBefore);
    expect(await readFile(sessionPath, "utf-8")).toBe(sessionBefore);
    expect(await readFile(path.join(repo, ".ai", "current-context.md"), "utf-8")).toBe(currentContextBefore);
    // The authored intent (acceptance criteria / verification) is preserved.
    expect((await readFile(planPath, "utf-8")).includes("Punch sync recorded in UTC.")).toBe(true);
    // The baseline block is preserved, never silently refreshed.
    expect((await readFile(planPath, "utf-8")).includes("commit: ")).toBe(true);
  });
});