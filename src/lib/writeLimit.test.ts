import { describe, expect, it } from "vitest";
import { createWriteLimiter, maxWritesFromEnv } from "./writeLimit.js";

describe("writeLimit", () => {
  it("allows exactly max calls, then refuses", () => {
    const l = createWriteLimiter(2);
    expect(l.take()).toBeNull();
    expect(l.take()).toBeNull();
    expect(l.take()).toMatch(/Ліміт записів/);
  });
  it("0 means unlimited", () => {
    const l = createWriteLimiter(0);
    for (let i = 0; i < 100; i++) expect(l.take()).toBeNull();
  });
  it("reads the env with a safe default of 10", () => {
    expect(maxWritesFromEnv({})).toBe(10);
    expect(maxWritesFromEnv({ PLANFIX_MAX_WRITES: "3" })).toBe(3);
    expect(maxWritesFromEnv({ PLANFIX_MAX_WRITES: "0" })).toBe(0);
    expect(maxWritesFromEnv({ PLANFIX_MAX_WRITES: "-1" })).toBe(10);
    expect(maxWritesFromEnv({ PLANFIX_MAX_WRITES: "abc" })).toBe(10);
  });
});
