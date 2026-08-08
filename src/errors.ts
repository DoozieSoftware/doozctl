/**
 * Shared error type for functionality reserved for a later phase.
 * Thrown by scaffolding stubs so the module surface is wired and testable
 * without implementing business logic.
 */
export class NotImplementedError extends Error {
  constructor(module: string) {
    super(`${module}: not implemented`);
    this.name = "NotImplementedError";
  }
}
