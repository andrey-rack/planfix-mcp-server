import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../helpers.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../helpers.js")>();
  return { ...actual, planfixRequest: vi.fn() };
});

import { planfixRequest } from "../helpers.js";
import tool from "./planfix_get_report_fields.js";

afterEach(() => {
  vi.clearAllMocks();
});

describe("planfix_get_report_fields input validation", () => {
  it.each(["1/../../x", "1?x=1", "abc", "", null])(
    "rejects non-numeric reportId %j before any request",
    async (reportId) => {
      await expect(tool.handler({ reportId } as never)).rejects.toThrow();
      expect(planfixRequest).not.toHaveBeenCalled();
    },
  );
});
