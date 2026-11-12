import { z } from "zod";
import { getTaskUrl, getToolWithHandler, log, planfixRequest } from "../helpers.js";

const MAX_PAGE = 100; // Planfix page limit
const SCAN_LIMIT = 1000; // how many tasks searchText is allowed to scan

export const ListTasksInputSchema = z.object({
  assigneeId: z.number().optional().describe("Filter by assignee user ID (use planfix_search_manager to get ID)"),
  projectId: z.number().optional().describe("Filter by project ID"),
  templateId: z.number().optional().describe("Filter by task template ID (lead, project, etc.)"),
  status: z
    .enum(["active", "completed", "all"])
    .optional()
    .default("active")
    .describe("Task status filter (default: active)"),
  searchText: z
    .string()
    .optional()
    .describe(
      `Case-insensitive text in the task name. Planfix cannot filter by name, so the server scans up to ${SCAN_LIMIT} tasks (matching the other filters) and keeps those that match: combine with templateId or dates to narrow the scan`,
    ),
  dateFrom: z.string().optional().describe("Created from this date (dd-mm-yyyy)"),
  dateTo: z.string().optional().describe("Created up to this date (dd-mm-yyyy)"),
  newest: z
    .boolean()
    .optional()
    .default(false)
    .describe("Return the most recently created tasks first (Planfix returns the oldest first by default). Use for «last N leads»"),
  pageSize: z.number().optional().default(20).describe(`Tasks to return (max ${MAX_PAGE} per Planfix page)`),
  offset: z.number().optional().default(0).describe("How many tasks to skip (from the start, or from the newest when newest=true)"),
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
  templateId: z.number().optional(),
  createdAt: z.string().optional().describe("Creation date and time, ISO (UTC)"),
  deadline: z.string().optional().describe("End date and time, ISO (UTC)"),
});

export const ListTasksOutputSchema = z.object({
  tasks: z.array(TaskItemSchema),
  totalCount: z.number().optional().describe("Total number of matching tasks. Known only with newest=true and no searchText"),
  hasMore: z.boolean().optional().describe("true when more tasks may follow this page"),
  scanned: z.number().optional().describe("How many tasks were scanned for searchText"),
  error: z.string().optional(),
});

interface RawTask {
  id: number;
  name?: string;
  status?: { id: number; name: string };
  assignees?: {
    users?: { id: string; name?: string }[];
    groups?: { id: number; name?: string }[];
  };
  project?: { id: number; name?: string };
  template?: { id: number };
  dateTime?: { datetime?: string };
  endDateTime?: { datetime?: string };
}

function mapTask(t: RawTask) {
  return {
    id: t.id,
    name: t.name ?? "",
    url: getTaskUrl(t.id),
    status: t.status ? { id: t.status.id, name: t.status.name } : undefined,
    assignees: t.assignees,
    project: t.project,
    templateId: t.template?.id,
    createdAt: t.dateTime?.datetime,
    deadline: t.endDateTime?.datetime,
  };
}

/** Largest index with a task + 1, found with doubling and bisection (Planfix returns no total). */
async function countTotal(page: (offset: number, size: number) => Promise<RawTask[]>): Promise<number> {
  const exists = async (i: number) => (await page(i, 1)).length > 0;
  if (!(await exists(0))) return 0;
  let lo = 0;
  let hi = 1;
  while (await exists(hi)) {
    lo = hi;
    hi *= 2;
  }
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (await exists(mid)) lo = mid;
    else hi = mid;
  }
  return lo + 1;
}

async function listTasks({
  assigneeId,
  projectId,
  templateId,
  status = "active",
  searchText,
  dateFrom,
  dateTo,
  newest = false,
  pageSize = 20,
  offset = 0,
}: z.infer<typeof ListTasksInputSchema>): Promise<z.infer<typeof ListTasksOutputSchema>> {
  try {
    // Filter formats verified against the live API: template, project and assignee take plain values.
    const filters: Array<Record<string, unknown>> = [];
    if (assigneeId) filters.push({ type: 2, operator: "equal", value: `user:${assigneeId}` });
    if (projectId) filters.push({ type: 5, operator: "equal", value: projectId });
    if (templateId) filters.push({ type: 51, operator: "equal", value: templateId });
    if (dateFrom || dateTo) {
      filters.push({
        type: 12, // creation date
        operator: "equal",
        value: {
          dateType: "otherRange",
          dateFrom: dateFrom ?? "01-01-2000",
          dateTo: dateTo ?? "31-12-2099",
        },
      });
    }

    const targetMap: Record<string, string> = {
      active: "ACTIVE ALL",
      completed: "COMPLETED ALL",
      all: "ALL",
    };

    const page = async (from: number, size: number): Promise<RawTask[]> => {
      const body: Record<string, unknown> = {
        offset: from,
        pageSize: size,
        fields: "id,name,status,assignees,project,template,dateTime,endDateTime",
        target: targetMap[status] ?? "ACTIVE ALL",
      };
      if (filters.length > 0) body.filters = filters;
      const result = (await planfixRequest({ path: "task/list", body })) as { tasks?: RawTask[] };
      return result.tasks ?? [];
    };

    const size = Math.max(1, Math.min(pageSize, MAX_PAGE));
    const needle = searchText?.trim().toLowerCase();
    const matches = (t: RawTask) => !needle || (t.name ?? "").toLowerCase().includes(needle);
    const newestFirst = (a: RawTask, b: RawTask) =>
      (b.dateTime?.datetime ?? "").localeCompare(a.dateTime?.datetime ?? "") || b.id - a.id;

    // 1) plain page from the start
    if (!newest && !needle) {
      const tasks = await page(offset, size);
      return { tasks: tasks.map(mapTask), hasMore: tasks.length === size };
    }

    // 2) a scan: newest-first from the end, or oldest-first from `offset`
    const total = newest ? await countTotal(page) : undefined;
    if (newest && !needle) {
      const end = Math.max(0, (total ?? 0) - offset);
      const start = Math.max(0, end - size);
      const tasks = end > start ? await page(start, end - start) : [];
      return { tasks: tasks.sort(newestFirst).map(mapTask), totalCount: total, hasMore: start > 0 };
    }

    const found: RawTask[] = [];
    let scanned = 0;
    let skipped = 0;
    let cursor = newest ? (total ?? 0) : offset; // newest scans backwards from the end
    let exhausted = false;
    while (found.length < size && scanned < SCAN_LIMIT) {
      const from = newest ? Math.max(0, cursor - MAX_PAGE) : cursor;
      const count = newest ? cursor - from : MAX_PAGE;
      if (count <= 0) {
        exhausted = true;
        break;
      }
      let chunk = await page(from, count);
      if (newest) chunk = chunk.sort(newestFirst);
      if (chunk.length === 0) {
        exhausted = true;
        break;
      }
      scanned += chunk.length;
      for (const t of chunk) {
        if (!matches(t)) continue;
        if (skipped < (newest ? offset : 0)) {
          skipped += 1;
          continue;
        }
        if (found.length < size) found.push(t);
      }
      cursor = newest ? from : cursor + chunk.length;
      if (newest && from === 0) {
        exhausted = true;
        break;
      }
      if (!newest && chunk.length < MAX_PAGE) {
        exhausted = true;
        break;
      }
    }
    return { tasks: found.map(mapTask), scanned, hasMore: !exhausted, ...(total !== undefined ? { totalCount: total } : {}) };
  } catch (error) {
    log("Exception in planfix_list_tasks: " + (error instanceof Error ? error.message : String(error)));
    return {
      tasks: [],
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
    "List Planfix tasks with filters: template (a lead, a project, ...), project, assignee, creation dates, name text. Returns name, status, assignees, project, templateId, createdAt. Planfix returns the oldest first: pass newest=true for «the last N leads/projects».",
  inputSchema: ListTasksInputSchema,
  outputSchema: ListTasksOutputSchema,
  handler,
});

export default planfixListTasksTool;
