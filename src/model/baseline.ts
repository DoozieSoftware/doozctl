/**
 * Baseline: the machine-read provenance contract (CONTEXT-SPEC §5, v3 A-4).
 *
 * A baseline is the `## Baseline` Markdown section an integrity-checkable
 * artifact uses to declare which repository state it was produced from, as
 * deterministic git facts — commit, branch, dirty — plus optional scope,
 * source and ownership declarations. Plans are rendered with the section by
 * the engine at creation; sessions and current context are template-owned and
 * render the same grammar wherever the package places it (D3), so the parser
 * locates the section by grammar (`^## Baseline` … next `^##`), never by file
 * position.
 *
 * Everything here is pure and deterministic: no clocks, no filesystem, no
 * git. Scope-path safety validation (D5) and the INVALID classification of
 * malformed baselines are later work packages (P05/P06); this module parses
 * the grammar and validates only the field shapes the grammar fixes.
 */

/** The `dirty` field values the grammar fixes. */
export type BaselineDirty = "yes" | "no";

/** The parsed `## Baseline` field set, in contract order (§5.2). */
export interface BaselineFields {
  /** Short or full hash of the repository state the artifact describes. */
  commit: string;
  /** Branch name at capture; detached HEAD records "(detached)". */
  branch: string;
  /** Whether the working tree had uncommitted changes at capture. */
  dirty: BaselineDirty;
  /**
   * Optional source reference: `plan:<id>`, `session:<ts>`, `none` when the
   * artifact is not derived, or ""/absent when the line is omitted.
   */
  source?: string;
  /**
   * Optional ownership declaration for mixed artifacts (`generated` /
   * `human` / `mixed`), or ""/absent when the line is omitted.
   */
  ownership?: string;
  /**
   * Optional repo-relative scope paths (exact paths or directory prefixes),
   * raw from the file. Path-safety validation is P05 (D5).
   */
  scopePaths?: string[];
}

/** The field key a `- key: value` bullet may carry inside `## Baseline`. */
type BaselineKey = "commit" | "branch" | "dirty" | "source" | "ownership" | "scope-path";

/** The three fields a baseline must declare to be evaluable. */
const REQUIRED_FIELDS: readonly BaselineKey[] = ["commit", "branch", "dirty"];

/** A deterministic parse outcome: absent, present-but-invalid, or valid. */
export type BaselineParse =
  | { readonly present: false }
  | { readonly present: true; readonly valid: false; readonly reason: string }
  | { readonly present: true; readonly valid: true; readonly fields: BaselineFields };

/** Whether `value` is one of the two grammar-fixed dirty values. */
function isBaselineDirty(value: string): value is BaselineDirty {
  return value === "yes" || value === "no";
}

/**
 * Parse the `## Baseline` section out of an artifact document. Returns
 * `{ present: false }` when the section is absent (a pre-v3 artifact — no
 * claim made, evaluated UNKNOWN by P06, never INVALID), a validity failure
 * when the section exists but breaks the grammar (evaluated INVALID), or the
 * field set.
 */
export function parseBaseline(content: string): BaselineParse {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const index = lines.findIndex((line) => /^##\s+Baseline\s*$/.test(line));
  if (index === -1) {
    return { present: false };
  }

  const values = new Map<BaselineKey, string[]>();
  for (let i = index + 1; i < lines.length; i += 1) {
    const line = lines[i] as string;
    if (/^##\s/.test(line)) {
      break;
    }
    const match = /^-\s*(commit|branch|dirty|source|ownership|scope-path):\s*(.*?)\s*$/.exec(line);
    if (match === null) {
      continue;
    }
    const key = match[1] as BaselineKey;
    const value = (match[2] ?? "").trim();
    const bucket = values.get(key) ?? [];
    bucket.push(value);
    values.set(key, bucket);
  }

  for (const key of REQUIRED_FIELDS) {
    const bucket = values.get(key);
    if (bucket === undefined || bucket.length === 0 || (bucket[0] ?? "") === "") {
      return { present: true, valid: false, reason: `baseline is missing required field: ${key}` };
    }
    if (bucket.length > 1) {
      return { present: true, valid: false, reason: `duplicate baseline field: ${key}` };
    }
  }

  const commit = values.get("commit")?.[0] ?? "";
  const branch = values.get("branch")?.[0] ?? "";
  const dirtyRaw = values.get("dirty")?.[0] ?? "";
  if (!isBaselineDirty(dirtyRaw)) {
    return {
      present: true,
      valid: false,
      reason: `invalid baseline dirty value: ${dirtyRaw}; expected yes or no`,
    };
  }

  const scalar = (key: BaselineKey): string => {
    const bucket = values.get(key);
    return bucket === undefined || bucket.length === 0 ? "" : (bucket[0] ?? "");
  };
  return {
    present: true,
    valid: true,
    fields: {
      commit,
      branch,
      dirty: dirtyRaw,
      source: scalar("source"),
      ownership: scalar("ownership"),
      scopePaths: values.get("scope-path") ?? [],
    },
  };
}

/**
 * Render the `## Baseline` section (without a trailing newline). Required
 * fields are always emitted; optional fields are emitted only when non-empty.
 * Deterministic for the same fields.
 */
export function renderBaseline(fields: BaselineFields): string {
  const lines: string[] = ["## Baseline", ""];
  const emit = (key: BaselineKey, value: string): void => {
    lines.push(`- ${key}: ${value}`);
  };
  emit("commit", fields.commit);
  emit("branch", fields.branch);
  emit("dirty", fields.dirty);
  const source = fields.source ?? "";
  if (source !== "") {
    emit("source", source);
  }
  const ownership = fields.ownership ?? "";
  if (ownership !== "") {
    emit("ownership", ownership);
  }
  for (const scopePath of fields.scopePaths ?? []) {
    emit("scope-path", scopePath);
  }
  return lines.join("\n");
}
