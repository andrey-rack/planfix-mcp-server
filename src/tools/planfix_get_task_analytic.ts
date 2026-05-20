import { z } from "zod";
import { getToolWithHandler, log, planfixRequest } from "../helpers.js";

export const GetTaskAnalyticInputSchema = z.object({
  taskId: z.number().describe("Planfix task ID"),
  datatagId: z
    .number()
    .optional()
    .describe("Datatag (analytic type) ID. If not provided, all datatags are returned."),
  pageSize: z.number().optional().default(100),
});

const AnalyticFieldSchema = z.object({
  id: z.number(),
  name: z.string(),
  value: z.unknown(),
  stringValue: z.string(),
});

const AnalyticEntrySchema = z.object({
  key: z.number(),
  fields: z.array(AnalyticFieldSchema),
});

const DatatagResultSchema = z.object({
  id: z.number(),
  name: z.string(),
  entries: z.array(AnalyticEntrySchema),
  totalCount: z.number(),
});

export const GetTaskAnalyticOutputSchema = z.object({
  datatags: z.array(DatatagResultSchema),
  error: z.string().optional(),
});

type DatatagRaw = { id: number; name?: string };

async function fetchAllDatatags(): Promise<DatatagRaw[]> {
  const result = (await planfixRequest({
    path: "datatag/list",
    body: { fields: "id,name", pageSize: 100 },
  })) as { dataTags?: DatatagRaw[] };
  return result.dataTags ?? [];
}

async function fetchDatatagFields(datatagId: number): Promise<{ id: number; name: string }[]> {
  const result = (await planfixRequest({
    path: `datatag/${datatagId}?fields=id,name,fields`,
    method: "GET",
  })) as { dataTag?: { fields?: { id: number; name: string }[] } };
  return result.dataTag?.fields ?? [];
}

async function fetchEntries(
  datatagId: number,
  taskId: number,
  fieldIds: number[],
  pageSize: number,
) {
  const fields = ["key", ...fieldIds.map(String)].join(",");
  const result = (await planfixRequest({
    path: `datatag/${datatagId}/entry/list`,
    body: { taskId, fields, pageSize },
  })) as {
    dataTagEntries?: Array<{
      key: number;
      customFieldData?: Array<{
        field: { id: number; name: string };
        value: unknown;
        stringValue: string;
      }>;
    }>;
  };

  const entries = (result.dataTagEntries ?? []).map((e) => ({
    key: e.key,
    fields: (e.customFieldData ?? []).map((f) => ({
      id: f.field.id,
      name: f.field.name,
      value: f.value,
      stringValue: f.stringValue,
    })),
  }));

  return entries;
}

async function getTaskAnalytic({
  taskId,
  datatagId,
  pageSize = 100,
}: z.infer<typeof GetTaskAnalyticInputSchema>): Promise<
  z.infer<typeof GetTaskAnalyticOutputSchema>
> {
  try {
    const allDatatags = await fetchAllDatatags();
    const targets = datatagId
      ? allDatatags.filter((d) => d.id === datatagId)
      : allDatatags;

    const results = await Promise.all(
      targets.map(async (datatag) => {
        const fieldDefs = await fetchDatatagFields(datatag.id);
        const fieldIds = fieldDefs.map((f) => f.id);
        const entries = await fetchEntries(datatag.id, taskId, fieldIds, pageSize);
        return {
          id: datatag.id,
          name: datatag.name ?? String(datatag.id),
          entries,
          totalCount: entries.length,
        };
      }),
    );

    const nonEmpty = results.filter((r) => r.totalCount > 0);

    return { datatags: nonEmpty };
  } catch (error) {
    log(
      "Exception in planfix_get_task_analytic: " +
        (error instanceof Error ? error.message : "Unknown error"),
    );
    return {
      datatags: [],
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

async function handler(args?: Record<string, unknown>) {
  const parsedArgs = GetTaskAnalyticInputSchema.parse(args);
  return await getTaskAnalytic(parsedArgs);
}

const planfixGetTaskAnalyticTool = getToolWithHandler({
  name: "planfix_get_task_analytic",
  description:
    "Get analytic (datatag) records linked to a specific Planfix task. Returns all non-empty analytic sections (Покупка: послуги, Контроль виплат фахівцям, etc.) or a specific one by datatagId.",
  inputSchema: GetTaskAnalyticInputSchema,
  outputSchema: GetTaskAnalyticOutputSchema,
  handler,
});

export default planfixGetTaskAnalyticTool;
