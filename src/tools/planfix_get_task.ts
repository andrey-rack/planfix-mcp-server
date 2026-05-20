import { z } from "zod";
import { getTaskUrl, getToolWithHandler, log, planfixRequest } from "../helpers.js";

export const GetTaskInputSchema = z.object({
  taskId: z.number().describe("Planfix task ID"),
});

export const GetTaskOutputSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string().optional(),
  status: z
    .object({
      id: z.number(),
      name: z.string(),
      isActive: z.boolean().optional(),
    })
    .optional(),
  assignees: z
    .object({
      users: z.array(z.object({ id: z.string(), name: z.string().optional() })).optional(),
      groups: z.array(z.object({ id: z.number(), name: z.string().optional() })).optional(),
    })
    .optional(),
  project: z.object({ id: z.number(), name: z.string().optional() }).optional(),
  owner: z.object({ id: z.string(), name: z.string().optional() }).optional(),
  dateBegin: z.string().optional(),
  dateEnd: z.string().optional(),
  customFieldData: z.array(z.unknown()).optional(),
  url: z.string(),
  error: z.string().optional(),
});

async function getTask({
  taskId,
}: z.infer<typeof GetTaskInputSchema>): Promise<z.infer<typeof GetTaskOutputSchema>> {
  try {
    const fields = [
      "id",
      "name",
      "description",
      "status",
      "assignees",
      "project",
      "owner",
      "dateBegin",
      "dateEnd",
      "customFieldData",
    ].join(",");

    const result = (await planfixRequest({
      path: `task/${taskId}?fields=${fields}`,
      method: "GET",
    })) as { task?: Record<string, unknown> };

    const task = result.task;
    if (!task) {
      return { id: taskId, name: "", url: getTaskUrl(taskId), error: "Task not found" };
    }

    return {
      id: taskId,
      name: (task.name as string) ?? "",
      description: task.description as string | undefined,
      status: task.status as GetTaskOutputSchema["status"],
      assignees: task.assignees as GetTaskOutputSchema["assignees"],
      project: task.project as GetTaskOutputSchema["project"],
      owner: task.owner as GetTaskOutputSchema["owner"],
      dateBegin: task.dateBegin as string | undefined,
      dateEnd: task.dateEnd as string | undefined,
      customFieldData: task.customFieldData as unknown[] | undefined,
      url: getTaskUrl(taskId),
    };
  } catch (error) {
    log("Exception in planfix_get_task: " + (error instanceof Error ? error.message : String(error)));
    return {
      id: taskId,
      name: "",
      url: getTaskUrl(taskId),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

type GetTaskOutputSchema = z.infer<typeof GetTaskOutputSchema>;

async function handler(args?: Record<string, unknown>) {
  const parsed = GetTaskInputSchema.parse(args);
  return await getTask(parsed);
}

const planfixGetTaskTool = getToolWithHandler({
  name: "planfix_get_task",
  description:
    "Get full details of a Planfix task by ID: name, description, status, assignees, project, dates, custom fields. Use before analyzing task analytics or to get full context of a lead/project.",
  inputSchema: GetTaskInputSchema,
  outputSchema: GetTaskOutputSchema,
  handler,
});

export default planfixGetTaskTool;
