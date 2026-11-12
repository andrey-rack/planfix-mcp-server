import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../helpers.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../helpers.js")>();
  return {
    ...actual,
    planfixRequest: vi.fn(),
    withCache: vi.fn((_name: string, fn: () => unknown) => fn()),
    log: vi.fn(),
  };
});

import { allowExtraProperties, planfixRequest } from "../helpers.js";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import planfixListTasksTool from "./planfix_list_tasks.js";
import { GetTaskCommentsOutputSchema } from "./planfix_get_task_comments.js";
import planfixGetTaskCommentsTool from "./planfix_get_task_comments.js";
import { runReport } from "./planfix_run_report.js";

const mockRequest = vi.mocked(planfixRequest);
const listTasks = (args: Record<string, unknown>) =>
  planfixListTasksTool.handler!(args) as Promise<{
    tasks: { id: number; templateId?: number; createdAt?: string }[];
    totalCount?: number;
    hasMore?: boolean;
    scanned?: number;
  }>;

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.useRealTimers());

describe("output schemas accept what Planfix really sends", () => {
  it("allowExtraProperties removes additionalProperties:false at every level", () => {
    const schema = zodToJsonSchema(z.object({ status: z.object({ id: z.number() }), list: z.array(z.object({ a: z.string() })) }));
    expect(JSON.stringify(schema)).toContain('"additionalProperties":false');
    expect(JSON.stringify(allowExtraProperties(schema))).not.toContain('"additionalProperties":false');
  });
  it("a comment type may be the string \"Comment\" or a number", () => {
    const base = { taskId: 1, taskUrl: "u", totalCount: 2 };
    expect(GetTaskCommentsOutputSchema.safeParse({ ...base, comments: [{ id: 1, type: "Comment" }, { id: 2, type: 3 }] }).success).toBe(true);
  });
  it("comments map dateTime to date and ask Planfix for dateTime", async () => {
    mockRequest.mockResolvedValueOnce({
      comments: [{ id: 5, description: "x", type: "Comment", dateTime: { datetime: "2026-11-11T17:05Z" } }],
      totalCount: 1,
    });
    const res = (await planfixGetTaskCommentsTool.handler!({ taskId: 9, pageSize: 1 })) as { comments: { date?: string; type?: string }[] };
    expect(res.comments[0]).toMatchObject({ date: "2026-11-11T17:05Z", type: "Comment" });
    expect(JSON.stringify(mockRequest.mock.calls[0][0])).toContain("dateTime");
  });
});

describe("planfix_list_tasks", () => {
  // a fake Planfix: N tasks, oldest first, filters ignored (we only check the request we send)
  const fake = (n: number) =>
    mockRequest.mockImplementation(async (args) => {
      const body = (args as unknown as { body: { offset: number; pageSize: number } }).body;
      const all = Array.from({ length: n }, (_, i) => ({
        id: i + 1,
        name: i % 10 === 0 ? `Call ${i + 1}` : `Лід ${i + 1}`,
        template: { id: 1111 },
        dateTime: { datetime: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString() },
      }));
      return { tasks: all.slice(body.offset, body.offset + body.pageSize) };
    });

  it("sends the filter formats Planfix accepts (plain values, creation date type 12)", async () => {
    fake(3);
    await listTasks({ templateId: 1111, projectId: 99, assigneeId: 6, dateFrom: "01-11-2026", status: "all" });
    const body = (mockRequest.mock.calls[0][0] as unknown as { body: { filters: unknown[]; target: string } }).body;
    expect(body.filters).toEqual([
      { type: 2, operator: "equal", value: "user:6" },
      { type: 5, operator: "equal", value: 99 },
      { type: 51, operator: "equal", value: 1111 },
      { type: 12, operator: "equal", value: { dateType: "otherRange", dateFrom: "01-11-2026", dateTo: "31-12-2099" } },
    ]);
    expect(body.target).toBe("ALL");
  });

  it("newest=true finds the total by bisection and returns the last tasks, newest first", async () => {
    fake(237);
    const res = await listTasks({ newest: true, pageSize: 5 });
    expect(res.totalCount).toBe(237);
    expect(res.tasks.map((t) => t.id)).toEqual([237, 236, 235, 234, 233]);
    expect(res.hasMore).toBe(true);
  });

  it("newest=true works for exact powers of two and tiny lists", async () => {
    for (const n of [0, 1, 2, 64, 65]) {
      fake(n);
      const res = await listTasks({ newest: true, pageSize: 3 });
      expect(res.totalCount).toBe(n);
      expect(res.tasks.length).toBe(Math.min(3, n));
    }
  });

  it("newest=true with offset skips the newest ones", async () => {
    fake(50);
    const res = await listTasks({ newest: true, pageSize: 3, offset: 10 });
    expect(res.tasks.map((t) => t.id)).toEqual([40, 39, 38]);
  });

  it("searchText is matched on the server side, newest first", async () => {
    fake(237);
    const res = await listTasks({ newest: true, pageSize: 3, searchText: "call" });
    expect(res.tasks.map((t) => t.id)).toEqual([231, 221, 211]);
    expect(res.scanned).toBeGreaterThan(0);
  });

  it("maps createdAt and templateId", async () => {
    fake(2);
    const res = await listTasks({ pageSize: 2 });
    expect(res.tasks[0]).toMatchObject({ id: 1, templateId: 1111, createdAt: "2026-01-01T00:00:00.000Z" });
  });
});

describe("planfix_run_report", () => {
  it("generate → GET status → data with chunk as query parameter", async () => {
    vi.useFakeTimers();
    mockRequest
      .mockResolvedValueOnce({ data: undefined, saves: [] }) // save/list: nothing fresh
      .mockResolvedValueOnce({ result: "success", requestId: "abc" }) // generate
      .mockResolvedValueOnce({ status: "ready", save: { id: 7, name: "n", reportId: 1, chunksCount: 2 } }) // status
      .mockResolvedValueOnce({ data: { rows: [{ type: "Header", items: [{ text: "A" }] }, { type: "Normal", items: [{ text: "1" }] }] } })
      .mockResolvedValueOnce({ data: { rows: [{ type: "Normal", items: [{ text: "2" }] }] } });
    const promise = runReport({ reportId: 1 });
    await vi.advanceTimersByTimeAsync(2000);
    const res = await promise;
    expect(res).toMatchObject({ success: true, rows: [{ A: "1" }, { A: "2" }], rowCount: 2 });
    const calls = mockRequest.mock.calls.map((c) => c[0] as { path: string; method?: string });
    expect(calls.map((c) => c.path)).toEqual([
      "report/1/save/list",
      "report/1/generate",
      "report/status/abc",
      "report/1/save/7/data?chunk=0",
      "report/1/save/7/data?chunk=1",
    ]);
    expect(calls[2].method).toBe("GET");
  });

  it("savedOnly reads the newest snapshot of any age and never generates", async () => {
    mockRequest
      .mockResolvedValueOnce({
        saves: [
          { id: 1, dateTime: { datetime: "2026-01-01T10:00Z" }, chunksCount: 1 },
          { id: 2, dateTime: { datetime: "2026-03-01T10:00Z" }, chunksCount: 1 },
        ],
      })
      .mockResolvedValueOnce({ data: { rows: [{ type: "Header", items: [{ text: "A" }] }, { type: "Normal", items: [{ text: "9" }] }] } });
    const res = await runReport({ reportId: 5, savedOnly: true });
    expect(res).toMatchObject({ success: true, rows: [{ A: "9" }], savedAt: "2026-03-01T10:00:00.000Z" });
    const paths = mockRequest.mock.calls.map((c) => (c[0] as { path: string }).path);
    expect(paths).toEqual(["report/5/save/list", "report/5/save/2/data?chunk=0"]);
    expect(paths.some((p) => p.includes("generate"))).toBe(false);
  });

  it("savedOnly without any snapshot fails clearly and does not generate", async () => {
    mockRequest.mockResolvedValueOnce({ saves: [] });
    const res = await runReport({ reportId: 5, savedOnly: true });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/no saved snapshot/);
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });
});
