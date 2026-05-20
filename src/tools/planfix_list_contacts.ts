import { z } from "zod";
import { getContactUrl, getToolWithHandler, log, planfixRequest } from "../helpers.js";

export const ListContactsInputSchema = z.object({
  searchText: z.string().optional().describe("Search by name, email or phone"),
  companyId: z.number().optional().describe("Filter contacts by company ID"),
  isCompany: z.boolean().optional().default(false).describe("Return companies instead of contacts"),
  pageSize: z.number().optional().default(20),
  offset: z.number().optional().default(0),
});

const ContactItemSchema = z.object({
  id: z.number(),
  name: z.string(),
  lastName: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  company: z.object({ id: z.number(), name: z.string().optional() }).optional(),
  lastCommentDate: z.string().optional(),
  url: z.string(),
});

export const ListContactsOutputSchema = z.object({
  contacts: z.array(ContactItemSchema),
  totalCount: z.number(),
  error: z.string().optional(),
});

async function listContacts({
  searchText,
  companyId,
  isCompany = false,
  pageSize = 20,
  offset = 0,
}: z.infer<typeof ListContactsInputSchema>): Promise<z.infer<typeof ListContactsOutputSchema>> {
  try {
    const filters: Array<{ type: number; operator: string; value: unknown }> = [];

    if (isCompany) {
      filters.push({ type: 4006, operator: "equal", value: true });
    }

    if (companyId) {
      filters.push({ type: 4009, operator: "equal", value: { id: companyId } });
    }

    if (searchText) {
      filters.push({ type: 4001, operator: "have", value: searchText });
    }

    const body: Record<string, unknown> = {
      offset,
      pageSize,
      fields: "id,name,lastName,email,phone,company,lastCommentDate",
    };

    if (filters.length > 0) {
      body.filters = filters;
    }

    const result = (await planfixRequest({
      path: "contact/list",
      body,
    })) as {
      contacts?: Array<{
        id: number;
        name?: string;
        lastName?: string;
        email?: string;
        phone?: string;
        company?: { id: number; name?: string };
        lastCommentDate?: string;
      }>;
      totalCount?: number;
    };

    const contacts = (result.contacts ?? []).map((c) => ({
      id: c.id,
      name: c.name ?? "",
      lastName: c.lastName,
      email: c.email,
      phone: c.phone,
      company: c.company,
      lastCommentDate: c.lastCommentDate,
      url: getContactUrl(c.id),
    }));

    return {
      contacts,
      totalCount: result.totalCount ?? contacts.length,
    };
  } catch (error) {
    log("Exception in planfix_list_contacts: " + (error instanceof Error ? error.message : String(error)));
    return {
      contacts: [],
      totalCount: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function handler(args?: Record<string, unknown>) {
  const parsed = ListContactsInputSchema.parse(args);
  return await listContacts(parsed);
}

const planfixListContactsTool = getToolWithHandler({
  name: "planfix_list_contacts",
  description:
    "List Planfix contacts with optional filters: search by name/email/phone, filter by company, or list companies. Returns lastCommentDate (last interaction date) for each contact.",
  inputSchema: ListContactsInputSchema,
  outputSchema: ListContactsOutputSchema,
  handler,
});

export default planfixListContactsTool;
