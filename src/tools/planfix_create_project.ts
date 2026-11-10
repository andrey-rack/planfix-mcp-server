import { z } from "zod";
import { getToolWithHandler, log, planfixRequest } from "../helpers.js";
import { PLANFIX_DRY_RUN } from "../config.js";
import { textToHtml, toPeopleRequest, toTimePoint } from "../lib/taskFields.js";

const DATE_HELP = 'Date as "dd-MM-yyyy" or "dd-MM-yyyy HH:mm"';
const id = () => z.number().int().positive();

export const CreateProjectInputSchema = z.object({
  name: z.string().min(1).describe("Project name"),
  description: z.string().optional().describe("Project description (plain text or simple HTML)"),
  parentProjectId: id().optional().describe("Create it inside this parent project"),
  ownerUserId: id().optional().describe("User id of the project owner"),
  statusId: id().optional().describe("Project status id"),
  templateId: id().optional().describe("Project template id"),
  groupId: id().optional().describe("Project group id"),
  startDate: z.string().optional().describe(`Start. ${DATE_HELP}`),
  endDate: z.string().optional().describe(`End. ${DATE_HELP}`),
  assigneeIds: z.array(id()).optional().describe("User ids of the project assignees"),
  assigneeGroupIds: z.array(id()).optional().describe("Group ids of the project assignees"),
});

export const CreateProjectOutputSchema = z.object({
  projectId: z.number(),
  dryRun: z.boolean().optional(),
  request: z.record(z.unknown()).optional(),
  error: z.string().optional(),
});

export function buildCreateProjectBody(
  args: z.infer<typeof CreateProjectInputSchema>,
): Record<string, unknown> {
  const body: Record<string, unknown> = { name: args.name };
  if (args.description !== undefined) body.description = textToHtml(args.description);
  if (args.parentProjectId !== undefined) body.parent = { id: args.parentProjectId };
  if (args.ownerUserId !== undefined) body.owner = { id: `user:${args.ownerUserId}` };
  if (args.statusId !== undefined) body.status = { id: args.statusId };
  if (args.templateId !== undefined) body.template = { id: args.templateId };
  if (args.groupId !== undefined) body.group = { id: args.groupId };
  if (args.startDate !== undefined) body.startDate = toTimePoint(args.startDate);
  if (args.endDate !== undefined) body.endDate = toTimePoint(args.endDate);
  if (args.assigneeIds !== undefined || args.assigneeGroupIds !== undefined) {
    body.assignees = toPeopleRequest(args.assigneeIds, args.assigneeGroupIds);
  }
  return body;
}

export async function createProject(
  args: z.infer<typeof CreateProjectInputSchema>,
): Promise<z.infer<typeof CreateProjectOutputSchema>> {
  try {
    const body = buildCreateProjectBody(args);
    if (PLANFIX_DRY_RUN) {
      log(`[DRY RUN] Would create project "${args.name}"`);
      return { projectId: 0, dryRun: true, request: { path: "project/", body } };
    }
    const result = await planfixRequest<{ id: number }>({ path: "project/", body });
    return { projectId: result.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    log(`[createProject] Error: ${message}`);
    return { projectId: 0, error: message };
  }
}

async function handler(args?: Record<string, unknown>) {
  return createProject(CreateProjectInputSchema.parse(args));
}

export const planfixCreateProjectTool = getToolWithHandler({
  name: "planfix_create_project",
  description:
    "Create a new Planfix project, optionally inside a parent project, with owner, status, dates and assignees. Returns the new projectId.",
  inputSchema: CreateProjectInputSchema,
  outputSchema: CreateProjectOutputSchema,
  handler,
});

export default planfixCreateProjectTool;
