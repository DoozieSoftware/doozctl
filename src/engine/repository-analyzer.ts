import { promises as fs } from "node:fs";
import path from "node:path";
import type { RepositoryInfo } from "../infra/git/git.js";
import type { Analysis, RepositoryStatistics } from "../model/model.js";
import type { Analyzer } from "./contracts.js";

/**
 * Repository Analyzer: produces factual, deterministic repository metadata.
 *
 * The analyzer is strictly read-only: it never writes files, runs builds or
 * tests, or accesses the network. Detection is based on file presence and
 * lightweight manifest parsing only. All outputs are sorted so results are
 * reproducible across platforms.
 */

/** Minimal git detection dependency, injectable for deterministic tests. */
export interface GitDetector {
  detect(dir: string): Promise<RepositoryInfo | null>;
}

/** Dependencies for the RepositoryAnalyzer. */
export interface RepositoryAnalyzerDeps {
  git: GitDetector;
}

/** File extensions mapped to their programming language. */
const LANGUAGES: Record<string, string> = {
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".mts": "TypeScript",
  ".cts": "TypeScript",
  ".js": "JavaScript",
  ".jsx": "JavaScript",
  ".mjs": "JavaScript",
  ".cjs": "JavaScript",
  ".php": "PHP",
  ".py": "Python",
  ".go": "Go",
  ".java": "Java",
  ".cs": "C#",
  ".rs": "Rust",
  ".rb": "Ruby",
  ".swift": "Swift",
  ".kt": "Kotlin",
  ".kts": "Kotlin",
  ".c": "C",
  ".h": "C",
  ".cpp": "C++",
  ".cc": "C++",
  ".hpp": "C++",
  ".scala": "Scala",
  ".dart": "Dart",
};

/** Directories never counted as repository content. */
const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "vendor",
  "dist",
  "build",
  "coverage",
  ".next",
  ".nuxt",
  "__pycache__",
  ".venv",
  "venv",
  "target",
  "out",
  ".idea",
  ".vscode",
]);

/** npm/Node dependency names mapped to their framework. */
const FRAMEWORK_BY_NPM_DEP: Record<string, string> = {
  react: "React",
  "react-dom": "React",
  vue: "Vue",
  "@angular/core": "Angular",
  express: "Express",
  next: "Next.js",
  "@nestjs/core": "NestJS",
  svelte: "Svelte",
  nuxt: "Nuxt.js",
  gatsby: "Gatsby",
  astro: "Astro",
  fastify: "Fastify",
};

/** Composer dependency names mapped to their framework. */
const FRAMEWORK_BY_COMPOSER_DEP: Record<string, string> = {
  "laravel/framework": "Laravel",
  "symfony/symfony": "Symfony",
};

/** Python dependency tokens mapped to their framework. */
const PYTHON_FRAMEWORKS: Array<[string, string]> = [
  ["fastapi", "FastAPI"],
  ["django", "Django"],
  ["flask", "Flask"],
];

/** Marker files mapping to their build system. */
const BUILD_MARKERS: Array<[string, string]> = [
  ["Makefile", "make"],
  ["CMakeLists.txt", "cmake"],
  ["pom.xml", "maven"],
  ["build.gradle", "gradle"],
  ["settings.gradle", "gradle"],
];

/** Lock/config files mapping to their package manager. */
const PACKAGE_MANAGERS: Array<[string, string]> = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["package-lock.json", "npm"],
  ["npm-shrinkwrap.json", "npm"],
  ["bun.lockb", "bun"],
  ["composer.lock", "composer"],
  ["Cargo.lock", "cargo"],
  ["go.sum", "go"],
  ["Gemfile.lock", "bundler"],
  ["Pipfile.lock", "pipenv"],
  ["poetry.lock", "poetry"],
];

/** Test config markers, checked in order. */
const TEST_MARKERS: Array<[RegExp, string]> = [
  [/^jest\.config/, "jest"],
  [/^vitest\.config/, "vitest"],
  [/^playwright\.config/, "playwright"],
  [/^cypress\.config/, "cypress"],
  [/^mocha\.opts$/, "mocha"],
  [/^phpunit\.xml/, "phpunit"],
  [/^pytest\.ini$/, "pytest"],
];

/** CI marker paths mapping to their provider. */
const CI_PROVIDERS: Array<[string, string]> = [
  [".github/workflows/", "github-actions"],
  [".gitlab-ci.yml", "gitlab-ci"],
  [".circleci/config.yml", "circleci"],
  ["Jenkinsfile", "jenkins"],
  ["azure-pipelines.yml", "azure-pipelines"],
  [".travis.yml", "travis"],
];

/** AI-related files detected by presence only, never interpreted. */
const AI_FILE_PATTERNS: string[] = [
  "AGENTS.md",
  "CLAUDE.md",
  "CODEX.md",
  "GEMINI.md",
  "CURSOR.md",
  "RULES.md",
  ".cursorrules",
  ".cursor/",
  ".claude/",
  ".github/copilot-instructions.md",
];

/** Detect whether a file name looks like a test file. */
function isTestFile(rel: string): boolean {
  const base = path.basename(rel);
  return (
    /\.(test|spec)\./.test(base) ||
    base.startsWith("test_") ||
    base.endsWith("_test.go") ||
    base.endsWith("_test.py") ||
    base.endsWith("Test.php") ||
    base.endsWith("Test.java") ||
    base.endsWith("Test.cs") ||
    base.endsWith("Tests.kt")
  );
}

/** Read a JSON manifest relative to root, or null when unreadable. */
async function readJson(root: string, rel: string): Promise<Record<string, unknown> | null> {
  try {
    const content = await fs.readFile(path.join(root, rel), "utf-8");
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Narrow an unknown value to a plain record. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Deterministic, read-only repository analysis. */
export class RepositoryAnalyzer implements Analyzer {
  constructor(private readonly deps: RepositoryAnalyzerDeps) {}

  async analyze(dir: string): Promise<Analysis> {
    const resolved = path.resolve(dir);
    const gitInfo = await this.deps.git.detect(resolved);
    const root = gitInfo?.root ?? resolved;
    const files = await this.walk(root);
    return {
      root,
      git: {
        isRepository: gitInfo !== null,
        branch: gitInfo?.branch ?? null,
        dirty: gitInfo?.dirty ?? false,
      },
      languages: this.detectLanguages(files),
      frameworks: await this.detectFrameworks(root, files),
      buildSystem: await this.detectBuildSystem(root, files),
      packageManager: this.detectPackageManager(files),
      testFramework: this.detectTestFramework(files),
      ci: this.detectCi(files),
      docker: this.detectDocker(files),
      statistics: this.computeStatistics(files),
      aiFiles: this.detectAiFiles(files),
    };
  }

  /** Collect regular file paths below root, sorted, ignoring build/dependency dirs. */
  private async walk(root: string): Promise<string[]> {
    const files: string[] = [];
    const visit = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (!IGNORED_DIRS.has(entry.name)) {
            await visit(path.join(dir, entry.name));
          }
        } else if (entry.isFile()) {
          files.push(path.relative(root, path.join(dir, entry.name)));
        }
      }
    };
    await visit(root);
    return files;
  }

  private detectLanguages(files: string[]): string[] {
    const found = new Set<string>();
    for (const file of files) {
      const language = LANGUAGES[path.extname(file).toLowerCase()];
      if (language !== undefined) {
        found.add(language);
      }
    }
    return [...found].sort();
  }

  private async detectFrameworks(root: string, files: string[]): Promise<string[]> {
    const found = new Set<string>();
    if (files.includes("package.json")) {
      const pkg = await readJson(root, "package.json");
      for (const section of ["dependencies", "devDependencies", "peerDependencies"]) {
        const deps = asRecord(pkg?.[section]);
        if (deps === null) continue;
        for (const name of Object.keys(deps)) {
          const framework = FRAMEWORK_BY_NPM_DEP[name];
          if (framework !== undefined) {
            found.add(framework);
          }
        }
      }
    }
    if (files.includes("composer.json")) {
      const composer = await readJson(root, "composer.json");
      for (const section of ["require", "require-dev"]) {
        const deps = asRecord(composer?.[section]);
        if (deps === null) continue;
        for (const name of Object.keys(deps)) {
          const framework = FRAMEWORK_BY_COMPOSER_DEP[name];
          if (framework !== undefined) {
            found.add(framework);
          }
        }
      }
    }
    for (const file of files) {
      const base = path.basename(file);
      if (base === "pyproject.toml" || base === "requirements.txt") {
        const content = await this.readText(root, file);
        if (content === null) continue;
        for (const [token, name] of PYTHON_FRAMEWORKS) {
          if (content.includes(token)) {
            found.add(name);
          }
        }
      }
      if (file.endsWith(".csproj")) {
        const content = await this.readText(root, file);
        if (content?.includes("Microsoft.AspNetCore")) {
          found.add("ASP.NET");
        }
      }
    }
    return [...found].sort();
  }

  private async detectBuildSystem(root: string, files: string[]): Promise<string | null> {
    for (const [marker, name] of BUILD_MARKERS) {
      if (files.includes(marker)) {
        return name;
      }
    }
    if (files.some((f) => /^webpack\.config(\.|$)/.test(f))) return "webpack";
    if (files.some((f) => /^vite\.config(\.|$)/.test(f))) return "vite";
    if (files.some((f) => /^rollup\.config(\.|$)/.test(f))) return "rollup";
    if (files.includes("package.json")) {
      const pkg = await readJson(root, "package.json");
      const scripts = asRecord(pkg?.["scripts"]);
      if (typeof scripts?.["build"] === "string") {
        return "npm";
      }
    }
    return null;
  }

  private detectPackageManager(files: string[]): string | null {
    for (const [marker, name] of PACKAGE_MANAGERS) {
      if (files.includes(marker)) {
        return name;
      }
    }
    return null;
  }

  private detectTestFramework(files: string[]): string | null {
    for (const file of files) {
      const base = path.basename(file);
      for (const [pattern, name] of TEST_MARKERS) {
        if (pattern.test(base)) {
          return name;
        }
      }
    }
    if (files.some((f) => f.endsWith("_test.go"))) return "go test";
    if (files.some((f) => f.endsWith("Test.php"))) return "phpunit";
    if (files.some((f) => f.endsWith("Test.java"))) return "junit";
    return null;
  }

  private detectCi(files: string[]): string[] {
    const found = new Set<string>();
    for (const [marker, name] of CI_PROVIDERS) {
      const present = marker.endsWith("/")
        ? files.some((f) => f.startsWith(marker))
        : files.includes(marker);
      if (present) {
        found.add(name);
      }
    }
    return [...found].sort();
  }

  private detectDocker(files: string[]): boolean {
    return files.some(
      (f) =>
        f === "Dockerfile" ||
        f.startsWith("Dockerfile.") ||
        f === "docker-compose.yml" ||
        f === "docker-compose.yaml" ||
        f === "compose.yml" ||
        f === "compose.yaml" ||
        f === ".dockerignore",
    );
  }

  private computeStatistics(files: string[]): RepositoryStatistics {
    let sourceFiles = 0;
    let testFiles = 0;
    for (const file of files) {
      const language = LANGUAGES[path.extname(file).toLowerCase()];
      if (language !== undefined) {
        sourceFiles++;
      }
      if (isTestFile(file)) {
        testFiles++;
      }
    }
    return { totalFiles: files.length, sourceFiles, testFiles };
  }

  private detectAiFiles(files: string[]): string[] {
    const found = new Set<string>();
    for (const file of files) {
      for (const pattern of AI_FILE_PATTERNS) {
        if (pattern.endsWith("/")) {
          if (file === pattern.slice(0, -1) || file.startsWith(pattern)) {
            found.add(pattern.slice(0, -1));
          }
        } else if (file === pattern) {
          found.add(pattern);
        }
      }
    }
    return [...found].sort();
  }

  private async readText(root: string, rel: string): Promise<string | null> {
    try {
      return await fs.readFile(path.join(root, rel), "utf-8");
    } catch {
      return null;
    }
  }
}
