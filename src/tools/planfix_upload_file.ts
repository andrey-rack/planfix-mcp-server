import { z } from "zod";
import fs from "fs";
import path from "path";
import { getToolWithHandler, log } from "../helpers.js";
import { PLANFIX_BASE_URL, PLANFIX_TOKEN } from "../config.js";

const UploadFileInputSchema = z.object({
  filePath: z
    .string()
    .describe("Absolute path to the local file to upload to Planfix"),
});

const UploadFileOutputSchema = z.object({
  fileId: z.number(),
  fileName: z.string().optional(),
  error: z.string().optional(),
});

export async function uploadFileToPlanfix(
  args: z.infer<typeof UploadFileInputSchema>,
): Promise<z.infer<typeof UploadFileOutputSchema>> {
  const { filePath } = args;

  try {
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(filePath);
    const fileName = path.basename(absolutePath);
    const fileContent = fs.readFileSync(absolutePath);

    const formData = new FormData();
    formData.append("file", new Blob([fileContent]), fileName);

    const response = await fetch(`${PLANFIX_BASE_URL}file/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PLANFIX_TOKEN}`,
        Accept: "application/json",
      },
      body: formData,
    });

    const result = (await response.json()) as {
      id?: number;
      name?: string;
      error?: string;
    };

    log(`[uploadFileToPlanfix] ${response.status} - ${fileName}`);

    if (!response.ok) {
      return {
        fileId: 0,
        error: result.error || `HTTP ${response.status}`,
      };
    }

    return { fileId: result.id ?? 0, fileName: result.name };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    log(`[uploadFileToPlanfix] Error: ${errorMessage}`);
    return { fileId: 0, error: errorMessage };
  }
}

async function handler(args?: Record<string, unknown>) {
  const parsed = UploadFileInputSchema.parse(args);
  return uploadFileToPlanfix(parsed);
}

export const planfixUploadFileTool = getToolWithHandler({
  name: "planfix_upload_file",
  description:
    "Upload a local file to Planfix and return its file ID. Use the returned fileId in planfix_create_general_task or planfix_create_comment to attach the file to a task or comment.",
  inputSchema: UploadFileInputSchema,
  outputSchema: UploadFileOutputSchema,
  handler,
});

export default planfixUploadFileTool;
