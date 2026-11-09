import { z } from "zod";
import { getToolWithHandler, planfixRequest } from "../helpers.js";

export const PlanfixRequestInputSchema = z.object({
  method: z
    .enum(["GET", "POST"])
    .default("POST")
    .describe("HTTP method to use for the request"),
  path: z.string().describe('API endpoint path (e.g., "contact/list")'),
  body: z
    .record(z.unknown())
    .optional()
    .describe("Request body as planfix request object"),
  cacheTime: z.number().optional().describe("Cache TTL in seconds"),
});

export const PlanfixRequestOutputSchema = z.record(z.unknown());

/**
 * Make a generic request to the Planfix API.
 * This tool allows making any API call to Planfix with the specified method, path, and body.
 */
export async function planfixRequestHandler(
  rawArgs: z.infer<typeof PlanfixRequestInputSchema>,
): Promise<z.infer<typeof PlanfixRequestOutputSchema>> {
  try {
    // The MCP SDK does not validate tool input, so enforce the schema (GET|POST only) here.
    const { method, path, body = {}, cacheTime } =
      PlanfixRequestInputSchema.parse(rawArgs);
    const response = await planfixRequest({ path, body, method, cacheTime });
    return response as Record<string, unknown>;
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    const args = (rawArgs ?? {}) as Record<string, unknown>;
    return {
      success: false,
      error: errorMessage,
      path: args.path,
      method: args.method,
    };
  }
}

export default getToolWithHandler({
  name: "planfix_request",
  description:
    "Make a generic request to the Planfix API with the specified method, path, and body. Use when swagger.json was read.",
  inputSchema: PlanfixRequestInputSchema,
  outputSchema: PlanfixRequestOutputSchema,
  handler: planfixRequestHandler,
});
