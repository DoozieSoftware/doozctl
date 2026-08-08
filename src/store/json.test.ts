import { describe, expect, it } from "vitest";
import { parseJson, serializeJson } from "./json.js";

describe("serializeJson", () => {
  it("serializes with sorted keys, two-space indent and trailing newline", () => {
    expect(serializeJson({ z: 1, a: { d: 4, c: 3 } })).toBe(
      '{\n  "a": {\n    "c": 3,\n    "d": 4\n  },\n  "z": 1\n}\n',
    );
  });

  it("produces identical bytes regardless of key insertion order", () => {
    const one = serializeJson({ a: 1, b: 2, c: { x: 1, y: 2 } });
    const two = serializeJson({ c: { y: 2, x: 1 }, b: 2, a: 1 });
    expect(one).toBe(two);
  });

  it("preserves array order", () => {
    const value = { list: ["b", "a", "c"] };
    expect(JSON.parse(serializeJson(value))).toEqual(value);
  });

  it("serializes Dates through JSON.stringify", () => {
    const date = new Date("2026-08-08T00:00:00.000Z");
    expect(JSON.parse(serializeJson({ at: date }))).toEqual({ at: "2026-08-08T00:00:00.000Z" });
  });

  it("rejects values that are not JSON-serializable", () => {
    expect(() => serializeJson(undefined)).toThrow(TypeError);
  });
});

describe("parseJson", () => {
  it("round-trips a value through serializeJson", () => {
    const value = { version: 1, artifacts: ["a", "b"], nested: { enabled: true } };
    expect(parseJson<typeof value>(serializeJson(value))).toEqual(value);
  });

  it("rejects invalid JSON", () => {
    expect(() => parseJson("{not json")).toThrow(SyntaxError);
  });
});
