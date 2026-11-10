import { z } from "zod";
import { getToolWithHandler, log, planfixRequest } from "../helpers.js";
import { PLANFIX_DRY_RUN } from "../config.js";
import { textToHtml } from "../lib/taskFields.js";

export const UpdateCommentInputSchema = z.object({
  commentId: z.number().int().positive().describe("Comment id"),
  taskId: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Task number, when the comment is on a task"),
  contactId: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Contact number, when the comment is on a contact"),
  description: z
    .string()
    .optional()
    .describe("New comment text (plain text or simple HTML). REPLACES the current text"),
  isPinned: z.boolean().optional().describe("Pin or unpin the comment"),
  isHidden: z.boolean().optional().describe("Hide or show the comment"),
});

export const UpdateCommentOutputSchema = z.object({
  updated: z.boolean(),
  commentId: z.number(),
  changed: z.array(z.string()).optional(),
  dryRun: z.boolean().optional(),
  error: z.string().optional(),
});

export async function updateComment(
  args: z.infer<typeof UpdateCommentInputSchema>,
): Promise<z.infer<typeof UpdateCommentOutputSchema>> {
  const { commentId, taskId, contactId, description, isPinned, isHidden } = args;
  try {
    if ((taskId === undefined) === (contactId === undefined)) {
      throw new Error("Pass exactly one of taskId or contactId");
    }
    const body: Record<string, unknown> = {};
    if (description !== undefined) body.description = textToHtml(description);
    if (isPinned !== undefined) body.isPinned = isPinned;
    if (isHidden !== undefined) body.isHidden = isHidden;
    if (Object.keys(body).length === 0) {
      throw new Error("Nothing to update: pass description, isPinned or isHidden");
    }
    const changed = Object.keys(body);
    const path =
      taskId !== undefined
        ? `task/${taskId}/comments/${commentId}`
        : `contact/${contactId}/comments/${commentId}`;

    if (PLANFIX_DRY_RUN) {
      log(`[DRY RUN] Would update comment ${commentId}: ${changed.join(", ")}`);
      return { updated: false, dryRun: true, commentId, changed };
    }
    await planfixRequest({ path, body });
    return { updated: true, commentId, changed };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    log(`[updateComment] Error: ${message}`);
    return { updated: false, commentId, error: message };
  }
}

async function handler(args?: Record<string, unknown>) {
  return updateComment(UpdateCommentInputSchema.parse(args));
}

export const planfixUpdateCommentTool = getToolWithHandler({
  name: "planfix_update_comment",
  description:
    "Edit an existing comment on a task or a contact: change its text, pin or hide it. The text is REPLACED. Pass exactly one of taskId or contactId.",
  inputSchema: UpdateCommentInputSchema,
  outputSchema: UpdateCommentOutputSchema,
  handler,
});

export default planfixUpdateCommentTool;
