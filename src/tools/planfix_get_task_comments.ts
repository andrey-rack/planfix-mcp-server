import { z } from "zod";
import { getTaskUrl, getToolWithHandler, log, planfixRequest } from "../helpers.js";

export const GetTaskCommentsInputSchema = z.object({
  taskId: z.number().describe("Planfix task ID"),
  pageSize: z.number().optional().default(20).describe("Number of comments to return (default 20)"),
  offset: z.number().optional().default(0),
});

const CommentSchema = z.object({
  id: z.number(),
  description: z.string().optional(),
  owner: z.object({ id: z.string(), name: z.string().optional() }).optional(),
  date: z.string().optional(),
  type: z.number().optional(),
});

export const GetTaskCommentsOutputSchema = z.object({
  taskId: z.number(),
  taskUrl: z.string(),
  comments: z.array(CommentSchema),
  totalCount: z.number(),
  error: z.string().optional(),
});

async function getTaskComments({
  taskId,
  pageSize = 20,
  offset = 0,
}: z.infer<typeof GetTaskCommentsInputSchema>): Promise<z.infer<typeof GetTaskCommentsOutputSchema>> {
  try {
    const result = (await planfixRequest({
      path: `task/${taskId}/comments/list`,
      body: {
        offset,
        pageSize,
        fields: "id,description,owner,date,type",
      },
    })) as {
      comments?: Array<{
        id: number;
        description?: string;
        owner?: { id: string; name?: string };
        date?: string;
        type?: number;
      }>;
      totalCount?: number;
    };

    const comments = (result.comments ?? []).map((c) => ({
      id: c.id,
      description: c.description,
      owner: c.owner,
      date: c.date,
      type: c.type,
    }));

    return {
      taskId,
      taskUrl: getTaskUrl(taskId),
      comments,
      totalCount: result.totalCount ?? comments.length,
    };
  } catch (error) {
    log("Exception in planfix_get_task_comments: " + (error instanceof Error ? error.message : String(error)));
    return {
      taskId,
      taskUrl: getTaskUrl(taskId),
      comments: [],
      totalCount: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function handler(args?: Record<string, unknown>) {
  const parsed = GetTaskCommentsInputSchema.parse(args);
  return await getTaskComments(parsed);
}

const planfixGetTaskCommentsTool = getToolWithHandler({
  name: "planfix_get_task_comments",
  description:
    "Get comments and interaction history for a Planfix task. The most recent comment date = last contact time. Use to answer: when was last contact on this lead? what happened with this project? who wrote what?",
  inputSchema: GetTaskCommentsInputSchema,
  outputSchema: GetTaskCommentsOutputSchema,
  handler,
});

export default planfixGetTaskCommentsTool;
