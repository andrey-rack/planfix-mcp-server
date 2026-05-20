import { z } from "zod";
import { getContactUrl, getToolWithHandler, log, planfixRequest } from "../helpers.js";

export const GetContactCommentsInputSchema = z.object({
  contactId: z.number().describe("Planfix contact ID"),
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

export const GetContactCommentsOutputSchema = z.object({
  contactId: z.number(),
  contactUrl: z.string(),
  comments: z.array(CommentSchema),
  totalCount: z.number(),
  error: z.string().optional(),
});

async function getContactComments({
  contactId,
  pageSize = 20,
  offset = 0,
}: z.infer<typeof GetContactCommentsInputSchema>): Promise<z.infer<typeof GetContactCommentsOutputSchema>> {
  try {
    const result = (await planfixRequest({
      path: `contact/${contactId}/comments/list`,
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
      contactId,
      contactUrl: getContactUrl(contactId),
      comments,
      totalCount: result.totalCount ?? comments.length,
    };
  } catch (error) {
    log("Exception in planfix_get_contact_comments: " + (error instanceof Error ? error.message : String(error)));
    return {
      contactId,
      contactUrl: getContactUrl(contactId),
      comments: [],
      totalCount: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function handler(args?: Record<string, unknown>) {
  const parsed = GetContactCommentsInputSchema.parse(args);
  return await getContactComments(parsed);
}

const planfixGetContactCommentsTool = getToolWithHandler({
  name: "planfix_get_contact_comments",
  description:
    "Get interaction history (comments) for a Planfix contact. Use to answer: when was the last call/interaction with this client? what was discussed? chronology of all communications.",
  inputSchema: GetContactCommentsInputSchema,
  outputSchema: GetContactCommentsOutputSchema,
  handler,
});

export default planfixGetContactCommentsTool;
