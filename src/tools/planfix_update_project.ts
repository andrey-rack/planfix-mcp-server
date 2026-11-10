import { z } from "zod";
import { getToolWithHandler, log, planfixRequest } from "../helpers.js";
import { PLANFIX_DRY_RUN } from "../config.js";
import { textToHtml, toPeopleRequest, toTimePoint } from "../lib/taskFields.js";

const DATE_HELP = 'Date as "dd-MM-yyyy" or "dd-MM-yyyy HH:mm"';
const id = () => z.number().int().positive();

export const UpdateProjectInputSchema = z.object({
  projectId: id().describe("Planfix project number"),
  name: z.string().min(1).optional().describe("New project name"),
  description: z
    .string()
    .optional()
    .describe("New description (plain text or simple HTML). REPLACES the current one"),
  statusId: id().optional().describe("New project status id"),
  ownerUserId: id().optional().describe("User id of the new owner"),
  parentProjectId: id().optional().describe("Move it inside this parent project"),
  endDate: z.string().optional().describe(`End. ${DATE_HELP}`),
  clearEndDate: z.boolean().optional().describe("Remove the end date"),
  assigneeIds: z
    .array(id())
    .optional()
    .describe("User ids. REPLACES the current user assignees: read the project first and keep the people who must stay"),
  assigneeGroupIds: z.array(id()).optional().describe("Group ids. REPLACES the current assignee groups"),
});

export const UpdateProjectOutputSchema = z.object({
  projectId: z.number(),
  changed: z.array(z.string()).optional(),
  dryRun: z.boolean().optional(),
  request: z.record(z.unknown()).optional(),
  error: z.string().optional(),
});

export function buildUpdateProjectBody(
  args: z.infer<typeof UpdateProjectInputSchema>,
): Record<string, unknown> {
  if (args.endDate !== undefined && args.clearEndDate) {
    throw new Error("endDate and clearEndDate cannot be used together");
  }
  const body: Record<string, unknown> = {};
  if (args.name !== undefined) body.name = args.name;
  if (args.description !== undefined) body.description = textToHtml(args.description);
  if (args.statusId !== undefined) body.status = { id: args.statusId };
  if (args.ownerUserId !== undefined) body.owner = { id: `user:${args.ownerUserId}` };
  if (args.parentProjectId !== undefined) body.parent = { id: args.parentProjectId };
  if (args.endDate !== undefined) {
    body.endDate = toTimePoint(args.endDate);
    body.hasEndDate = true;
  } else if (args.clearEndDate) {
    body.hasEndDate = false;
  }
  if (args.assigneeIds !== undefined || args.assigneeGroupIds !== undefined) {
    body.assignees = toPeopleRequest(args.assigneeIds, args.assigneeGroupIds);
  }
  if (Object.keys(body).length === 0) {
    throw new Error("Nothing to update: pass at least one field to change");
  }
  return body;
}

export async function updateProject(
  args: z.infer<typeof UpdateProjectInputSchema>,
): Promise<z.infer<typeof UpdateProjectOutputSchema>> {
  const { projectId } = args;
  try {
    const body = buildUpdateProjectBody(args);
    const changed = Object.keys(body);
    if (PLANFIX_DRY_RUN) {
      log(`[DRY RUN] Would update project ${projectId}: ${changed.join(", ")}`);
      return { projectId, dryRun: true, changed, request: { path: `project/${projectId}`, body } };
    }
    await planfixRequest({ path: `project/${projectId}`, body });
    return { projectId, changed };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    log(`[updateProject] Error: ${message}`);
    return { projectId, error: message };
  }
}

async function handler(args?: Record<string, unknown>) {
  return updateProject(UpdateProjectInputSchema.parse(args));
}

export const planfixUpdateProjectTool = getToolWithHandler({
  name: "planfix_update_project",
  description:
    "Change an existing Planfix project: name, description, status, owner, parent, end date or assignees. Only the fields you pass are changed; description and assignees are REPLACED.",
  inputSchema: UpdateProjectInputSchema,
  outputSchema: UpdateProjectOutputSchema,
  handler,
});

export default planfixUpdateProjectTool;
