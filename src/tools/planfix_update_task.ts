import { z } from "zod";
import { getTaskUrl, getToolWithHandler, log, planfixRequest } from "../helpers.js";
import { PLANFIX_DRY_RUN } from "../config.js";
import { textToHtml, toPeopleRequest, toTimePoint } from "../lib/taskFields.js";

const DATE_HELP =
  'Date as "dd-MM-yyyy" or "dd-MM-yyyy HH:mm" (also "yyyy-MM-dd" or "yyyy-MM-dd HH:mm")';

export const UpdateTaskInputSchema = z.object({
  taskId: z.number().int().positive().describe("Planfix task number"),
  name: z.string().min(1).optional().describe("New task title"),
  description: z
    .string()
    .optional()
    .describe(
      "New description (plain text or simple HTML). REPLACES the whole current description",
    ),
  priority: z.enum(["NotUrgent", "Urgent"]).optional(),
  statusId: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("New status id. Get the valid ids from planfix_get_task_statuses"),
  assigneeIds: z
    .array(z.number().int().positive())
    .optional()
    .describe(
      "User ids. REPLACES the current user assignees: read the task first and include the people who must stay. [] removes all of them",
    ),
  assigneeGroupIds: z
    .array(z.number().int().positive())
    .optional()
    .describe("Group ids. REPLACES the current assignee groups"),
  startDate: z.string().optional().describe(`Start. ${DATE_HELP}`),
  endDate: z.string().optional().describe(`Deadline. ${DATE_HELP}`),
  clearStartDate: z.boolean().optional().describe("Remove the start date"),
  clearEndDate: z.boolean().optional().describe("Remove the deadline"),
  projectId: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Move the task to this project"),
});

export const UpdateTaskOutputSchema = z.object({
  taskId: z.number(),
  url: z.string().optional(),
  changed: z.array(z.string()).optional(),
  dryRun: z.boolean().optional(),
  request: z.record(z.unknown()).optional(),
  error: z.string().optional(),
});

type UpdateTaskInput = z.infer<typeof UpdateTaskInputSchema>;

/** Builds the Planfix POST task/{id} body. Never sets "silent": every change stays visible in the task log. */
export function buildUpdateTaskBody(args: UpdateTaskInput): Record<string, unknown> {
  if (args.startDate !== undefined && args.clearStartDate) {
    throw new Error("startDate and clearStartDate cannot be used together");
  }
  if (args.endDate !== undefined && args.clearEndDate) {
    throw new Error("endDate and clearEndDate cannot be used together");
  }

  const body: Record<string, unknown> = {};
  if (args.name !== undefined) body.name = args.name;
  if (args.description !== undefined) body.description = textToHtml(args.description);
  if (args.priority) body.priority = args.priority;
  if (args.statusId !== undefined) body.status = { id: args.statusId };
  if (args.assigneeIds !== undefined || args.assigneeGroupIds !== undefined) {
    body.assignees = toPeopleRequest(args.assigneeIds, args.assigneeGroupIds);
  }
  if (args.startDate !== undefined) {
    const point = toTimePoint(args.startDate);
    body.startDateTime = point;
    body.hasStartDate = true;
    body.hasStartTime = point.time !== undefined;
  } else if (args.clearStartDate) {
    body.hasStartDate = false;
  }
  if (args.endDate !== undefined) {
    const point = toTimePoint(args.endDate);
    body.endDateTime = point;
    body.hasEndDate = true;
    body.hasEndTime = point.time !== undefined;
  } else if (args.clearEndDate) {
    body.hasEndDate = false;
  }
  if (args.projectId !== undefined) body.project = { id: args.projectId };

  if (Object.keys(body).length === 0) {
    throw new Error("Nothing to update: pass at least one field to change");
  }
  return body;
}

export async function updateTask(
  args: UpdateTaskInput,
): Promise<z.infer<typeof UpdateTaskOutputSchema>> {
  const { taskId } = args;
  try {
    const body = buildUpdateTaskBody(args);
    const changed = Object.keys(body);

    if (PLANFIX_DRY_RUN) {
      log(`[DRY RUN] Would update task ${taskId}: ${changed.join(", ")}`);
      return { taskId, dryRun: true, changed, request: { path: `task/${taskId}`, body } };
    }

    const result = await planfixRequest<{ failures?: unknown[] }>({
      path: `task/${taskId}`,
      body,
    });
    if (Array.isArray(result?.failures) && result.failures.length > 0) {
      return {
        taskId,
        url: getTaskUrl(taskId),
        error: `Planfix refused part of the update: ${JSON.stringify(result.failures).slice(0, 300)}`,
      };
    }
    return { taskId, url: getTaskUrl(taskId), changed };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    log(`[updateTask] Error: ${message}`);
    return { taskId, error: message };
  }
}

async function handler(args?: Record<string, unknown>) {
  return updateTask(UpdateTaskInputSchema.parse(args));
}

export const planfixUpdateTaskTool = getToolWithHandler({
  name: "planfix_update_task",
  description:
    "Change an existing Planfix task: title, description, priority, status, assignees, start date, deadline or project. Works on ANY task. Only the fields you pass are changed. Assignees and description are REPLACED, not appended. Get status ids from planfix_get_task_statuses first.",
  inputSchema: UpdateTaskInputSchema,
  outputSchema: UpdateTaskOutputSchema,
  handler,
});

export default planfixUpdateTaskTool;
