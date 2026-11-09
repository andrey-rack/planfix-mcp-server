import { z } from "zod";
import fs from "fs";
import path from "path";
import { getToolWithHandler, log } from "../helpers.js";
import {
  PLANFIX_BASE_URL,
  PLANFIX_TOKEN,
  PLANFIX_UPLOAD_DIR,
} from "../config.js";

const UploadFileInputSchema = z.object({
  filePath: z
    .string()
    .describe(
      "Path to a file inside the allowed upload folder (PLANFIX_UPLOAD_DIR). Files outside it, hidden files and files over 25 MB are refused.",
    ),
});

const UploadFileOutputSchema = z.object({
  fileId: z.number(),
  fileName: z.string().optional(),
  error: z.string().optional(),
});

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * Resolve a file path strictly inside PLANFIX_UPLOAD_DIR.
 * Prevents a prompt-injected model from uploading arbitrary local files (SSH keys, configs, ...).
 */
export function resolveAllowedUploadPath(
  filePath: string,
  uploadDir: string = PLANFIX_UPLOAD_DIR,
): string {
  if (!uploadDir) {
    throw new Error(
      "File upload is disabled: set PLANFIX_UPLOAD_DIR to the one folder you allow uploads from",
    );
  }
  const root = fs.realpathSync(uploadDir);
  const real = fs.realpathSync(path.resolve(root, filePath));
  const rel = path.relative(root, real);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("File is outside the allowed upload folder");
  }
  if (rel.split(path.sep).some((part) => part.startsWith("."))) {
    throw new Error("Hidden files and folders are not allowed");
  }
  const stat = fs.statSync(real);
  if (!stat.isFile() || stat.size > MAX_UPLOAD_BYTES) {
    throw new Error("Not a regular file, or larger than 25 MB");
  }
  return real;
}

export async function uploadFileToPlanfix(
  args: z.infer<typeof UploadFileInputSchema>,
): Promise<z.infer<typeof UploadFileOutputSchema>> {
  const { filePath } = args;

  try {
    const absolutePath = resolveAllowedUploadPath(filePath);
    const fileName = path.basename(absolutePath);
    const fileContent = fs.readFileSync(absolutePath);

    const formData = new FormData();
    formData.append("file", new Blob([fileContent]), fileName);

    const response = await fetch(`${PLANFIX_BASE_URL}file/`, {
      method: "POST",
      redirect: "error",
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
