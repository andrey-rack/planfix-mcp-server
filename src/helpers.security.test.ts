import { describe, it, expect } from "vitest";
import { assertSafeApiPath } from "./helpers.js";

describe("assertSafeApiPath", () => {
  it.each(["task/123", "contact/list", "report/139346/run", "task/1/comments/?fields=id,name"])(
    "accepts %s",
    (p) => {
      expect(() => assertSafeApiPath(p)).not.toThrow();
    },
  );

  it.each([
    "../admin",
    "task/../../x",
    "/rest/task/1",
    "//evil.com/x",
    "@evil.com/x",
    "https://evil.com/x",
    "a\\b",
    "task/%2e%2e/x",
    "task/..%2fx",
    "task/1\n2",
    "",
  ])("rejects %j", (p) => {
    expect(() => assertSafeApiPath(p)).toThrow();
  });
});
