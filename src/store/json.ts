/**
 * Canonical JSON helpers for persisted engine metadata.
 *
 * Persistence is deterministic: identical values always serialize to
 * identical bytes regardless of key insertion order. Storage stays
 * string-only; callers compose `serializeJson` with it, for example
 * `storage.atomicWrite(".dooz/manifest.json", serializeJson(manifest))`.
 */

/** Return a JSON-safe deep clone of `value` with object keys sorted. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      return value;
    }
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** Serialize a value to canonical JSON plus a trailing newline. */
export function serializeJson(value: unknown): string {
  const json = JSON.stringify(canonicalize(value), null, 2);
  if (json === undefined) {
    throw new TypeError("value is not JSON-serializable");
  }
  return json + "\n";
}

/** Parse canonical JSON back into a value. */
export function parseJson<T>(raw: string): T {
  return JSON.parse(raw) as T;
}
