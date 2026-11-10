import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../helpers.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../helpers.js")>();
  return {
    ...actual,
    planfixRequest: vi.fn().mockResolvedValue({ id: 7 }),
    log: vi.fn(),
  };
});
vi.mock("../config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../config.js")>()),
  PLANFIX_DRY_RUN: false,
}));

import { planfixRequest } from "../helpers.js";
import { toPeopleRequest, toTimePoint } from "../lib/taskFields.js";
import { buildUpdateTaskBody, updateTask } from "./planfix_update_task.js";
import { getTaskStatuses } from "./planfix_get_task_statuses.js";
import { attachFile } from "./planfix_attach_file.js";
import { updateComment } from "./planfix_update_comment.js";
import { buildCreateProjectBody, createProject } from "./planfix_create_project.js";
import { buildUpdateProjectBody } from "./planfix_update_project.js";
import {
  createChecklistItem,
  getTaskChecklist,
  updateChecklistItem,
} from "./planfix_checklist.js";
import { createGeneralTask } from "./planfix_create_general_task.js";
import { createComment } from "./planfix_create_comment.js";

const mockRequest = vi.mocked(planfixRequest);
afterEach(() => vi.clearAllMocks());

describe("taskFields", () => {
  it("parses dates in both orders, with and without time", () => {
    expect(toTimePoint("29-05-2026")).toEqual({ date: "29-05-2026" });
    expect(toTimePoint("29-05-2026 23:59:00")).toEqual({ date: "29-05-2026", time: "23:59" });
    expect(toTimePoint("2026-05-29T09:05")).toEqual({ date: "29-05-2026", time: "09:05" });
  });
  it("rejects impossible dates, times and junk", () => {
    expect(() => toTimePoint("31-02-2026")).toThrow(/Invalid calendar date/);
    expect(() => toTimePoint("29-05-2026 24:00")).toThrow(/Invalid time/);
    expect(() => toTimePoint("tomorrow")).toThrow(/Unrecognized date/);
  });
  it("prefixes users but not groups", () => {
    expect(toPeopleRequest([5], [2])).toEqual({ users: [{ id: "user:5" }], groups: [{ id: 2 }] });
  });
});

describe("planfix_update_task", () => {
  it("builds status, assignee and deadline with the TimePoint shape", () => {
    expect(
      buildUpdateTaskBody({ taskId: 1, statusId: 3, assigneeIds: [5], endDate: "29-05-2026 18:00" }),
    ).toEqual({
      status: { id: 3 },
      assignees: { users: [{ id: "user:5" }] },
      endDateTime: { date: "29-05-2026", time: "18:00" },
      hasEndDate: true,
      hasEndTime: true,
    });
  });
  it("clears a deadline and never sends silent", () => {
    const body = buildUpdateTaskBody({ taskId: 1, clearEndDate: true });
    expect(body).toMatchObject({ hasEndDate: false });
    expect(body).not.toHaveProperty("silent");
  });
  it("refuses an empty update and conflicting flags", () => {
    expect(() => buildUpdateTaskBody({ taskId: 1 })).toThrow(/Nothing to update/);
    expect(() => buildUpdateTaskBody({ taskId: 1, endDate: "29-05-2026", clearEndDate: true })).toThrow();
  });
  it("posts to task/{id} and reports the changed fields", async () => {
    const res = await updateTask({ taskId: 42, description: "a\nb" });
    expect(mockRequest).toHaveBeenCalledWith({ path: "task/42", body: { description: "a<br>b" } });
    expect(res).toMatchObject({ taskId: 42, changed: ["description"] });
  });
  it("turns a Planfix failure into an error, not a success", async () => {
    mockRequest.mockResolvedValueOnce({ failures: [{ message: "no access" }] });
    expect((await updateTask({ taskId: 42, name: "x" })).error).toBeTruthy();
  });
});

describe("planfix_get_task_statuses", () => {
  it("reads the task's process first, then that process's statuses", async () => {
    mockRequest
      .mockResolvedValueOnce({ task: { processId: 9, status: { id: 1, name: "New" } } })
      .mockResolvedValueOnce({ statuses: [{ id: 1, name: "New" }, { id: 2, name: "Done" }] });
    const res = await getTaskStatuses({ taskId: 5 });
    expect(mockRequest.mock.calls[0][0]).toMatchObject({ method: "GET" });
    expect(mockRequest.mock.calls[1][0].path).toContain("process/task/9/statuses");
    expect(res.statuses.map((s) => s.id)).toEqual([1, 2]);
  });
  it("explains a task without a process", async () => {
    mockRequest.mockResolvedValueOnce({ task: { status: { id: 1 } } });
    expect((await getTaskStatuses({ taskId: 5 })).error).toMatch(/not part of a process/);
  });
});

describe("attach / comment edit", () => {
  it("attaches by query string", async () => {
    const res = await attachFile({ fileId: 11, taskId: 22 });
    expect(mockRequest).toHaveBeenCalledWith({ path: "file/11/attach/task?id=22", method: "POST", body: {} });
    expect(res.attached).toBe(true);
  });
  it("edits a task comment and requires exactly one target", async () => {
    await updateComment({ commentId: 3, taskId: 4, description: "new" });
    expect(mockRequest).toHaveBeenCalledWith({ path: "task/4/comments/3", body: { description: "new" } });
    expect((await updateComment({ commentId: 3, description: "x" })).error).toMatch(/exactly one/);
    expect((await updateComment({ commentId: 3, taskId: 4 })).error).toMatch(/Nothing to update/);
  });
  it("sends fileIds on create_comment only when given", async () => {
    await createComment({ taskId: 1, description: "hi", fileIds: [8] });
    expect(mockRequest.mock.calls[0][0].body).toMatchObject({ files: [{ id: 8 }] });
    await createComment({ taskId: 1, description: "hi" });
    expect(mockRequest.mock.calls[1][0].body).not.toHaveProperty("files");
  });
});

describe("projects", () => {
  it("builds a project body", () => {
    expect(
      buildCreateProjectBody({ name: "P", parentProjectId: 2, ownerUserId: 5, endDate: "01-12-2026" }),
    ).toEqual({
      name: "P",
      parent: { id: 2 },
      owner: { id: "user:5" },
      endDate: { date: "01-12-2026" },
    });
  });
  it("creates and returns the id", async () => {
    expect(await createProject({ name: "P" })).toEqual({ projectId: 7 });
    expect(mockRequest.mock.calls[0][0].path).toBe("project/");
  });
  it("update needs a change; end date sets hasEndDate", () => {
    expect(() => buildUpdateProjectBody({ projectId: 1 })).toThrow(/Nothing to update/);
    expect(buildUpdateProjectBody({ projectId: 1, endDate: "01-12-2026" })).toMatchObject({
      hasEndDate: true,
    });
  });
});

describe("checklist", () => {
  it("lists, adds and ticks items", async () => {
    mockRequest.mockResolvedValueOnce({ items: [{ id: 1, name: "a", isDone: false }] });
    expect((await getTaskChecklist({ taskId: 9 })).items).toHaveLength(1);
    expect(await createChecklistItem({ taskId: 9, name: "b" })).toEqual({ itemId: 7 });
    expect(mockRequest.mock.calls[1][0]).toEqual({ path: "task/9/checklist", body: { name: "b" } });
    await updateChecklistItem({ taskId: 9, itemId: 1, isDone: true });
    expect(mockRequest.mock.calls[2][0]).toEqual({ path: "task/9/checklist/1", body: { isDone: true } });
  });
  it("refuses an empty checklist update", async () => {
    expect((await updateChecklistItem({ taskId: 9, itemId: 1 })).error).toMatch(/Nothing to update/);
  });
});

describe("create_general_task regression", () => {
  it("sends the deadline as endDateTime and files as a plain id list", async () => {
    await createGeneralTask({ name: "T", dateEnd: "29-05-2026 23:59:00", fileIds: [4] });
    expect(mockRequest.mock.calls[0][0].body).toEqual({
      name: "T",
      files: [{ id: 4 }],
      endDateTime: { date: "29-05-2026", time: "23:59" },
      hasEndDate: true,
    });
  });
  it("returns an error for a bad deadline instead of creating the task", async () => {
    const res = await createGeneralTask({ name: "T", dateEnd: "soon" });
    expect(res.error).toMatch(/Unrecognized date/);
    expect(mockRequest).not.toHaveBeenCalled();
  });
});
