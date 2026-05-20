import { z } from "zod";
import { getContactUrl, getToolWithHandler, log, planfixRequest } from "../helpers.js";

export const GetContactInputSchema = z.object({
  contactId: z.number().describe("Planfix contact ID"),
});

export const GetContactOutputSchema = z.object({
  id: z.number(),
  name: z.string(),
  lastName: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  telegram: z.string().optional(),
  post: z.string().optional(),
  company: z.object({ id: z.number(), name: z.string().optional() }).optional(),
  customFieldData: z.array(z.unknown()).optional(),
  lastUpdateDate: z.string().optional(),
  lastCommentDate: z.string().optional(),
  url: z.string(),
  error: z.string().optional(),
});

async function getContact({
  contactId,
}: z.infer<typeof GetContactInputSchema>): Promise<z.infer<typeof GetContactOutputSchema>> {
  try {
    const fields = [
      "id",
      "name",
      "lastName",
      "email",
      "phone",
      "telegram",
      "post",
      "company",
      "customFieldData",
      "lastUpdateDate",
      "lastCommentDate",
    ].join(",");

    const result = (await planfixRequest({
      path: `contact/${contactId}?fields=${fields}`,
      method: "GET",
    })) as { contact?: Record<string, unknown> };

    const contact = result.contact;
    if (!contact) {
      return { id: contactId, name: "", url: getContactUrl(contactId), error: "Contact not found" };
    }

    return {
      id: contactId,
      name: (contact.name as string) ?? "",
      lastName: contact.lastName as string | undefined,
      email: contact.email as string | undefined,
      phone: contact.phone as string | undefined,
      telegram: contact.telegram as string | undefined,
      post: contact.post as string | undefined,
      company: contact.company as GetContactOutputSchema["company"],
      customFieldData: contact.customFieldData as unknown[] | undefined,
      lastUpdateDate: contact.lastUpdateDate as string | undefined,
      lastCommentDate: contact.lastCommentDate as string | undefined,
      url: getContactUrl(contactId),
    };
  } catch (error) {
    log("Exception in planfix_get_contact: " + (error instanceof Error ? error.message : String(error)));
    return {
      id: contactId,
      name: "",
      url: getContactUrl(contactId),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

type GetContactOutputSchema = z.infer<typeof GetContactOutputSchema>;

async function handler(args?: Record<string, unknown>) {
  const parsed = GetContactInputSchema.parse(args);
  return await getContact(parsed);
}

const planfixGetContactTool = getToolWithHandler({
  name: "planfix_get_contact",
  description:
    "Get full details of a Planfix contact by ID: name, email, phone, telegram, company, custom fields, lastCommentDate (= last interaction date). Use after planfix_search_contact to get full info.",
  inputSchema: GetContactInputSchema,
  outputSchema: GetContactOutputSchema,
  handler,
});

export default planfixGetContactTool;
