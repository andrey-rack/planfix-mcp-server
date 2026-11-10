import { z } from "zod";
import { getTaskUrl, getToolWithHandler, log, planfixRequest } from "../helpers.js";
import { PLANFIX_DRY_RUN } from "../config.js";

export const AttachFileInputSchema = z.object({
  fileId: z
    .number()
    .int()
    .positive()
    .describe("Planfix file id, returned by planfix_upload_file"),
  taskId: z.number().int().positive().describe("Existing Planfix task number"),
});

export const AttachFileOutputSchema = z.object({
  attached: z.boolean(),
  fileId: z.number(),
  taskId: z.number(),
  url: z.string().optional(),
  dryRun: z.boolean().optional(),
  error: z.string().optional(),
});

export async function attachFile(
  args: z.infer<typeof AttachFileInputSchema>,
): Promise<z.infer<typeof AttachFileOutputSchema>> {
  const { fileId, taskId } = args;
  try {
    const path = `file/${fileId}/attach/task?id=${taskId}`;
    if (PLANFIX_DRY_RUN) {
      log(`[DRY RUN] Would attach file ${fileId} to task ${taskId}`);
      return { attached: false, dryRun: true, fileId, taskId, url: getTaskUrl(taskId) };
    }
    await planfixRequest({ path, method: "POST", body: {} });
    return { attached: true, fileId, taskId, url: getTaskUrl(taskId) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    log(`[attachFile] Error: ${message}`);
    return { attached: false, fileId, taskId, error: message };
  }
}

async function handler(args?: Record<string, unknown>) {
  return attachFile(AttachFileInputSchema.parse(args));
}

export const planfixAttachFileTool = getToolWithHandler({
  name: "planfix_attach_file",
  description:
    "Attach an already uploaded file to an EXISTING Planfix task. First upload the file with planfix_upload_file to get its fileId.",
  inputSchema: AttachFileInputSchema,
  outputSchema: AttachFileOutputSchema,
  handler,
});

export default planfixAttachFileTool;
