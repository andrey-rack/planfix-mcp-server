import { z } from "zod";
import { getToolWithHandler, log, planfixRequest } from "../helpers.js";
import { PLANFIX_DRY_RUN } from "../config.js";
import { toPeopleRequest } from "../lib/taskFields.js";

const id = () => z.number().int().positive();

// ---------------------------------------------------------------- read
export const GetChecklistInputSchema = z.object({
  taskId: id().describe("Planfix task number"),
});

export const GetChecklistOutputSchema = z.object({
  taskId: z.number(),
  items: z.array(z.record(z.unknown())),
  error: z.string().optional(),
});

export async function getTaskChecklist(
  args: z.infer<typeof GetChecklistInputSchema>,
): Promise<z.infer<typeof GetChecklistOutputSchema>> {
  const { taskId } = args;
  try {
    const result = await planfixRequest<{ items?: Record<string, unknown>[] }>({
      path: `task/${taskId}/checklist/list`,
      body: { offset: 0, pageSize: 100, fields: "id,name,isDone,parent,assignees" },
    });
    return { taskId, items: result.items ?? [] };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    log(`[getTaskChecklist] Error: ${message}`);
    return { taskId, items: [], error: message };
  }
}

// -------------------------------------------------------------- create
export const CreateChecklistItemInputSchema = z.object({
  taskId: id().describe("Planfix task number"),
  name: z.string().min(1).describe("Checklist item text"),
  isDone: z.boolean().optional().describe("Create it already ticked"),
  assigneeIds: z.array(id()).optional().describe("User ids responsible for this item"),
  parentItemId: id().optional().describe("Nest it under this checklist item"),
});

export const CreateChecklistItemOutputSchema = z.object({
  itemId: z.number(),
  dryRun: z.boolean().optional(),
  error: z.string().optional(),
});

export async function createChecklistItem(
  args: z.infer<typeof CreateChecklistItemInputSchema>,
): Promise<z.infer<typeof CreateChecklistItemOutputSchema>> {
  const { taskId, name, isDone, assigneeIds, parentItemId } = args;
  try {
    const body: Record<string, unknown> = { name };
    if (isDone !== undefined) body.isDone = isDone;
    if (assigneeIds !== undefined) body.assignees = toPeopleRequest(assigneeIds);
    if (parentItemId !== undefined) body.parent = { id: parentItemId };
    if (PLANFIX_DRY_RUN) {
      log(`[DRY RUN] Would add checklist item to task ${taskId}: ${name}`);
      return { itemId: 0, dryRun: true };
    }
    const result = await planfixRequest<{ id?: number }>({
      path: `task/${taskId}/checklist`,
      body,
    });
    return { itemId: result.id ?? 0 };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    log(`[createChecklistItem] Error: ${message}`);
    return { itemId: 0, error: message };
  }
}

// -------------------------------------------------------------- update
export const UpdateChecklistItemInputSchema = z.object({
  taskId: id().describe("Planfix task number"),
  itemId: id().describe("Checklist item id (from planfix_get_task_checklist)"),
  name: z.string().min(1).optional().describe("New text of the item"),
  isDone: z.boolean().optional().describe("true = tick it, false = untick it"),
  assigneeIds: z
    .array(id())
    .optional()
    .describe("User ids. REPLACES the current responsible users of this item"),
});

export const UpdateChecklistItemOutputSchema = z.object({
  updated: z.boolean(),
  itemId: z.number(),
  changed: z.array(z.string()).optional(),
  dryRun: z.boolean().optional(),
  error: z.string().optional(),
});

export async function updateChecklistItem(
  args: z.infer<typeof UpdateChecklistItemInputSchema>,
): Promise<z.infer<typeof UpdateChecklistItemOutputSchema>> {
  const { taskId, itemId, name, isDone, assigneeIds } = args;
  try {
    const body: Record<string, unknown> = {};
    if (name !== undefined) body.name = name;
    if (isDone !== undefined) body.isDone = isDone;
    if (assigneeIds !== undefined) body.assignees = toPeopleRequest(assigneeIds);
    if (Object.keys(body).length === 0) {
      throw new Error("Nothing to update: pass name, isDone or assigneeIds");
    }
    const changed = Object.keys(body);
    if (PLANFIX_DRY_RUN) {
      log(`[DRY RUN] Would update checklist item ${itemId} of task ${taskId}`);
      return { updated: false, dryRun: true, itemId, changed };
    }
    await planfixRequest({ path: `task/${taskId}/checklist/${itemId}`, body });
    return { updated: true, itemId, changed };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    log(`[updateChecklistItem] Error: ${message}`);
    return { updated: false, itemId, error: message };
  }
}

// ----------------------------------------------------------- the tools
export const planfixGetTaskChecklistTool = getToolWithHandler({
  name: "planfix_get_task_checklist",
  description: "List the checklist items of a Planfix task (id, text, done or not, responsible users).",
  inputSchema: GetChecklistInputSchema,
  outputSchema: GetChecklistOutputSchema,
  handler: async (args?: Record<string, unknown>) =>
    getTaskChecklist(GetChecklistInputSchema.parse(args)),
});

export const planfixCreateChecklistItemTool = getToolWithHandler({
  name: "planfix_create_checklist_item",
  description: "Add an item to the checklist of an existing Planfix task. Returns the new itemId.",
  inputSchema: CreateChecklistItemInputSchema,
  outputSchema: CreateChecklistItemOutputSchema,
  handler: async (args?: Record<string, unknown>) =>
    createChecklistItem(CreateChecklistItemInputSchema.parse(args)),
});

export const planfixUpdateChecklistItemTool = getToolWithHandler({
  name: "planfix_update_checklist_item",
  description:
    "Change a checklist item of a Planfix task: tick or untick it, rename it, or change who is responsible. Get itemId from planfix_get_task_checklist.",
  inputSchema: UpdateChecklistItemInputSchema,
  outputSchema: UpdateChecklistItemOutputSchema,
  handler: async (args?: Record<string, unknown>) =>
    updateChecklistItem(UpdateChecklistItemInputSchema.parse(args)),
});
