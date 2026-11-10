import { z } from "zod";
import { getToolWithHandler, log, planfixRequest } from "../helpers.js";

export const GetTaskStatusesInputSchema = z.object({
  taskId: z.number().int().positive().describe("Planfix task number"),
});

export const GetTaskStatusesOutputSchema = z.object({
  taskId: z.number(),
  processId: z.number().optional(),
  currentStatus: z.object({ id: z.number(), name: z.string().optional() }).optional(),
  statuses: z.array(
    z.object({
      id: z.number(),
      name: z.string(),
      isActive: z.boolean().optional(),
      hasDeadline: z.boolean().optional(),
    }),
  ),
  error: z.string().optional(),
});

/** The statuses belong to the task's PROCESS, so read the task's processId first. */
export async function getTaskStatuses(
  args: z.infer<typeof GetTaskStatusesInputSchema>,
): Promise<z.infer<typeof GetTaskStatusesOutputSchema>> {
  const { taskId } = args;
  try {
    const taskResult = await planfixRequest<{
      task?: { processId?: number; status?: { id: number; name?: string } };
    }>({
      path: `task/${taskId}?fields=id,processId,status`,
      method: "GET",
    });
    const task = taskResult.task;
    if (!task) {
      return { taskId, statuses: [], error: "Task not found" };
    }
    if (!task.processId) {
      return {
        taskId,
        statuses: [],
        currentStatus: task.status,
        error: "The task is not part of a process, so it has no status list",
      };
    }
    const statusResult = await planfixRequest<{
      statuses?: { id: number; name: string; isActive?: boolean; hasDeadline?: boolean }[];
    }>({
      path: `process/task/${task.processId}/statuses?fields=id,name,isActive,hasDeadline`,
      method: "GET",
    });
    return {
      taskId,
      processId: task.processId,
      currentStatus: task.status,
      statuses: (statusResult.statuses ?? []).map(({ id, name, isActive, hasDeadline }) => ({
        id,
        name,
        isActive,
        hasDeadline,
      })),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    log(`[getTaskStatuses] Error: ${message}`);
    return { taskId, statuses: [], error: message };
  }
}

async function handler(args?: Record<string, unknown>) {
  return getTaskStatuses(GetTaskStatusesInputSchema.parse(args));
}

export const planfixGetTaskStatusesTool = getToolWithHandler({
  name: "planfix_get_task_statuses",
  description:
    "List the statuses a Planfix task can be moved to (and its current status). Use the returned ids as statusId in planfix_update_task.",
  inputSchema: GetTaskStatusesInputSchema,
  outputSchema: GetTaskStatusesOutputSchema,
  handler,
});

export default planfixGetTaskStatusesTool;
