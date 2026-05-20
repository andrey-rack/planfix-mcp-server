import { z } from "zod";
import { getTaskUrl, getToolWithHandler, log, planfixRequest } from "../helpers.js";

export const ListTasksInputSchema = z.object({
  assigneeId: z.number().optional().describe("Filter by assignee user ID (use planfix_search_manager to get ID)"),
  projectId: z.number().optional().describe("Filter by project ID"),
  templateId: z.number().optional().describe("Filter by task template ID (lead, project, etc.)"),
  status: z
    .enum(["active", "completed", "all"])
    .optional()
    .default("active")
    .describe("Task status filter (default: active)"),
  searchText: z.string().optional().describe("Search in task name"),
  dateFrom: z.string().optional().describe("Filter tasks starting from date (dd-mm-yyyy)"),
  dateTo: z.string().optional().describe("Filter tasks ending before date (dd-mm-yyyy)"),
  pageSize: z.number().optional().default(20),
  offset: z.number().optional().default(0),
});

const TaskItemSchema = z.object({
  id: z.number(),
  name: z.string(),
  url: z.string(),
  status: z.object({ id: z.number(), name: z.string() }).optional(),
  assignees: z
    .object({
      users: z.array(z.object({ id: z.string(), name: z.string().optional() })).optional(),
      groups: z.array(z.object({ id: z.number(), name: z.string().optional() })).optional(),
    })
    .optional(),
  project: z.object({ id: z.number(), name: z.string().optional() }).optional(),
  dateBegin: z.string().optional(),
  dateEnd: z.string().optional(),
});

export const ListTasksOutputSchema = z.object({
  tasks: z.array(TaskItemSchema),
  totalCount: z.number(),
  error: z.string().optional(),
});

async function listTasks({
  assigneeId,
  projectId,
  templateId,
  status = "active",
  searchText,
  dateFrom,
  dateTo,
  pageSize = 20,
  offset = 0,
}: z.infer<typeof ListTasksInputSchema>): Promise<z.infer<typeof ListTasksOutputSchema>> {
  try {
    const filters: Array<Record<string, unknown>> = [];

    if (assigneeId) {
      filters.push({ type: 3104, operator: "equal", value: { id: assigneeId } });
    }

    if (projectId) {
      filters.push({ type: 62, operator: "equal", value: { id: projectId } });
    }

    if (templateId) {
      filters.push({ type: 51, operator: "equal", value: { id: templateId } });
    }

    if (searchText) {
      filters.push({ type: 8, operator: "have", value: searchText });
    }

    if (dateFrom || dateTo) {
      filters.push({
        type: 3101,
        operator: "equal",
        value: {
          dateType: "otherRange",
          dateFrom: dateFrom ?? "01-01-2020",
          dateTo: dateTo ?? "31-12-2099",
        },
      });
    }

    // Map status to Planfix target param
    const targetMap: Record<string, string> = {
      active: "ACTIVE ALL",
      completed: "COMPLETED ALL",
      all: "ALL",
    };

    const body: Record<string, unknown> = {
      offset,
      pageSize,
      fields: "id,name,status,assignees,project,dateBegin,dateEnd",
      target: targetMap[status] ?? "ACTIVE ALL",
    };

    if (filters.length > 0) {
      body.filters = filters;
    }

    const result = (await planfixRequest({
      path: "task/list",
      body,
    })) as {
      tasks?: Array<{
        id: number;
        name?: string;
        status?: { id: number; name: string };
        assignees?: {
          users?: { id: string; name?: string }[];
          groups?: { id: number; name?: string }[];
        };
        project?: { id: number; name?: string };
        dateBegin?: string;
        dateEnd?: string;
      }>;
      totalCount?: number;
    };

    const tasks = (result.tasks ?? []).map((t) => ({
      id: t.id,
      name: t.name ?? "",
      url: getTaskUrl(t.id),
      status: t.status,
      assignees: t.assignees,
      project: t.project,
      dateBegin: t.dateBegin,
      dateEnd: t.dateEnd,
    }));

    return {
      tasks,
      totalCount: result.totalCount ?? tasks.length,
    };
  } catch (error) {
    log("Exception in planfix_list_tasks: " + (error instanceof Error ? error.message : String(error)));
    return {
      tasks: [],
      totalCount: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function handler(args?: Record<string, unknown>) {
  const parsed = ListTasksInputSchema.parse(args);
  return await listTasks(parsed);
}

const planfixListTasksTool = getToolWithHandler({
  name: "planfix_list_tasks",
  description:
    "List Planfix tasks with filters: by assignee (use assigneeId from planfix_search_manager), project, template, status (active/completed/all), name search, or date range. Use to answer: what tasks does person X have? show active projects. leads without response this week.",
  inputSchema: ListTasksInputSchema,
  outputSchema: ListTasksOutputSchema,
  handler,
});

export default planfixListTasksTool;
