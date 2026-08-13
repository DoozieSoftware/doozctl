import {
  formatPlanDate,
  isValidPlanId,
  parsePlan,
  planFilename,
  renderPlan,
  setPlanStatus,
  transitionPlan,
  type Plan,
  type PlanAnyStatus,
  type PlanTemplateInput,
} from "../model/plan.js";
import { Storage } from "./storage.js";

/** The two plan directories Phase 2.2 manages. */
export type PlanState = "active" | "completed";

/** Clock dependency so plan creation dates are deterministic in tests. */
export interface PlanStoreDeps {
  now: () => Date;
}

/** A plan located on disk: which directory it lives in and the file name. */
interface LocatedPlan {
  state: PlanState;
  filename: string;
  plan: Plan;
}

/** Whether `filename` matches the `YYYY-MM-DD-<id>.md` shape for `id`. */
const PLAN_FILE_PATTERN = /^\d{4}-\d{2}-\d{2}-([a-z0-9]+(-[a-z0-9]+)*)\.md$/;

/**
 * Plan Store: owns the engine's Plan state under `.dooz/plans/`:
 *
 *   .dooz/plans/active/<created>-<id>.md
 *   .dooz/plans/completed/<created>-<id>.md
 *
 * Plans are Markdown; the store only understands the frozen metadata fields.
 * The lifecycle moves forward only, and only a completed plan is moved from
 * active/ to completed/. All paths go through the sandboxed Storage.
 */
export class PlanStore {
  constructor(private readonly deps: PlanStoreDeps) {}

  /**
   * Create a new plan in active/ at PLANNED. Fails if a plan with the same
   * id and creation date already exists.
   */
  async create(root: string, input: PlanTemplateInput): Promise<Plan> {
    if (!isValidPlanId(input.id)) {
      throw new Error(`invalid plan id: ${input.id}`);
    }
    if (input.method.trim() === "") {
      throw new Error("plan method must not be empty");
    }
    const created = formatPlanDate(this.deps.now());
    const filename = planFilename(created, input.id);
    const storage = new Storage(root);
    const parts = [".dooz", "plans", "active", filename];
    if (await storage.exists(...parts)) {
      throw new Error(`plan already exists: ${input.id}`);
    }
    const content = renderPlan(input, created);
    await storage.atomicWrite(content, ...parts);
    return parsePlan(content);
  }

  /** Load a plan by id, searching active/ then completed/. */
  async load(root: string, id: string): Promise<Plan> {
    return (await this.locate(root, id)).plan;
  }

  /** List the plan file names in the given state directory, sorted. */
  async list(root: string, state: PlanState): Promise<string[]> {
    return new Storage(root).list(".dooz", "plans", state);
  }

  /**
   * Replace a plan's content in place. The parsed content must keep the
   * plan's identity (id and created date) and its current status — status
   * changes happen only through transition. A byte-identical update writes
   * nothing.
   */
  async update(root: string, id: string, content: string): Promise<Plan> {
    const located = await this.locate(root, id);
    const parsed = parsePlan(content);
    if (parsed.id !== located.plan.id) {
      throw new Error("update cannot change the plan id");
    }
    if (parsed.created !== located.plan.created) {
      throw new Error("update cannot change the plan creation date");
    }
    if (parsed.status !== located.plan.status) {
      throw new Error("update cannot change the plan status; use transition");
    }
    const storage = new Storage(root);
    const parts = [".dooz", "plans", located.state, located.filename];
    const current = await storage.read(...parts);
    if (current !== content) {
      await storage.atomicWrite(content, ...parts);
    }
    return parsed;
  }

  /**
   * Advance a plan along the lifecycle. Same-status transitions are no-ops.
   * Transitioning to COMPLETED moves the plan from active/ to completed/,
   * writing the destination first so a failure never loses the plan.
   */
  async transition(root: string, id: string, to: PlanAnyStatus): Promise<Plan> {
    const located = await this.locate(root, id);
    const next = transitionPlan(located.plan.status, to);
    if (next === located.plan.status) {
      return located.plan;
    }
    const content = setPlanStatus(located.plan.content, next);
    const storage = new Storage(root);
    const targetState: PlanState = next === "COMPLETED" ? "completed" : "active";
    const sourceParts = [".dooz", "plans", located.state, located.filename];
    if (targetState === located.state) {
      await storage.atomicWrite(content, ...sourceParts);
    } else {
      const targetParts = [".dooz", "plans", targetState, located.filename];
      await storage.atomicWrite(content, ...targetParts);
      await storage.delete(...sourceParts);
    }
    return parsePlan(content);
  }

  /**
   * Find a plan by id. The id must exist in exactly one directory: a plan in
   * both active/ and completed/ is ambiguous, and plans in neither are absent.
   */
  private async locate(root: string, id: string): Promise<LocatedPlan> {
    if (!isValidPlanId(id)) {
      throw new Error(`invalid plan id: ${id}`);
    }
    const storage = new Storage(root);
    const matches: LocatedPlan[] = [];
    for (const state of ["active", "completed"] as const) {
      for (const filename of await storage.list(".dooz", "plans", state)) {
        const match = PLAN_FILE_PATTERN.exec(filename);
        if (match !== null && match[1] === id) {
          const content = await storage.read(".dooz", "plans", state, filename);
          matches.push({ state, filename, plan: parsePlan(content) });
        }
      }
    }
    if (matches.length === 0) {
      throw new Error(`plan not found: ${id}`);
    }
    if (matches.length > 1) {
      throw new Error(`plan is ambiguous (found in active/ and completed/): ${id}`);
    }
    return matches[0] as LocatedPlan;
  }
}
