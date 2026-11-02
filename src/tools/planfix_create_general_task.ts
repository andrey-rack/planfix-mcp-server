import { z } from "zod";
import { getToolWithHandler, getTaskUrl, planfixRequest } from "../helpers.js";
import { searchProject } from "./planfix_search_project.js";

const CreateGeneralTaskInputSchema = z.object({
  name: z.string().describe("Task name"),
  description: z.string().optional().describe("Task description (HTML allowed)"),
  projectId: z.number().optional().describe("Project ID (use instead of projectName if known)"),
  projectName: z.string().optional().describe("Project name to search for"),
  assigneeIds: z.array(z.number()).optional().describe("Array of user IDs to assign"),
  dateEnd: z
    .string()
    .optional()
    .describe('Deadline in format "dd-MM-yyyy HH:mm:ss", e.g. "29-05-2026 23:59:00"'),
  fileIds: z
    .array(z.number())
    .optional()
    .describe("Array of Planfix file IDs to attach. Upload files first with planfix_upload_file to get IDs."),
});

const CreateGeneralTaskOutputSchema = z.object({
  taskId: z.number(),
  url: z.string().optional(),
  error: z.string().optional(),
});

export async function createGeneralTask(
  args: z.infer<typeof CreateGeneralTaskInputSchema>,
): Promise<z.infer<typeof CreateGeneralTaskOutputSchema>> {
  const { name, description, projectId, projectName, assigneeIds, dateEnd, fileIds } = args;

  let resolvedProjectId = projectId ?? 0;

  if (!resolvedProjectId && projectName) {
    const projectResult = await searchProject({ name: projectName });
    if (projectResult.found) {
      resolvedProjectId = projectResult.projectId;
    }
  }

  const body: Record<string, unknown> = { name };

  if (description) {
    body.description = description.replace(/\n/g, "<br>");
  }
  if (resolvedProjectId) {
    body.project = { id: resolvedProjectId };
  }
  if (assigneeIds?.length) {
    body.assignees = { users: assigneeIds.map((id) => ({ id: `user:${id}` })) };
  }
  if (dateEnd) {
    body.dateEnd = dateEnd;
  }
  if (fileIds?.length) {
    body.files = { items: fileIds.map((id) => ({ id })) };
  }

  try {
    const result = await planfixRequest<{ id: number }>({ path: "task/", body });
    return { taskId: result.id, url: getTaskUrl(result.id) };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return { taskId: 0, error: errorMessage };
  }
}

async function handler(args?: Record<string, unknown>) {
  const parsed = CreateGeneralTaskInputSchema.parse(args);
  return createGeneralTask(parsed);
}

export const planfixCreateGeneralTaskTool = getToolWithHandler({
  name: "planfix_create_general_task",
  description:
    "Create a general (non-lead) task in Planfix. Use when creating a project task, work item, or any task that is NOT a sales lead. Supports project lookup by name, assigning users, and setting a deadline.",
  inputSchema: CreateGeneralTaskInputSchema,
  outputSchema: CreateGeneralTaskOutputSchema,
  handler,
});

export default planfixCreateGeneralTaskTool;
