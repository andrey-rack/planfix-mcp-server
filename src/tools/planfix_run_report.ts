import { z } from "zod";
import {
  getToolWithHandler,
  log,
  planfixRequest,
  withCache,
} from "../helpers.js";

const CACHE_TIME = Number(process.env.PLANFIX_REPORTS_CACHE_TIME || 600);
const CACHE_PREFIX = "planfix_report_";

// helper to compute ISO week number
function getISOWeek(date: Date): { year: number; week: number } {
  const tmp = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const dayNum = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(
    ((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
  );
  return { year: tmp.getUTCFullYear(), week: weekNo };
}

// process grouping and sorting of rows
export function processRows(
  rows: ReportRows,
  groupFields?: string[],
  groupPeriod?: "day" | "week" | "month",
  sortFields?: string[],
): ReportRows {
  const result = rows.map((r) => ({ ...r }));

  if (groupFields?.length && groupPeriod) {
    result.forEach((row) => {
      groupFields.forEach((field) => {
        const val = row[field];
        const d = new Date(val);
        if (!isNaN(d.getTime())) {
          if (groupPeriod === "day") {
            row[field] = d.toISOString().slice(0, 10);
          } else if (groupPeriod === "month") {
            row[field] = d.toISOString().slice(0, 7);
          } else if (groupPeriod === "week") {
            const { year, week } = getISOWeek(d);
            row[field] = `${year}-W${week.toString().padStart(2, "0")}`;
          }
        }
      });
    });
  }

  // apply sorting, global or within groups with stable group order
  if (!sortFields?.length) {
    return result;
  }
  if (groupFields?.length && groupPeriod) {
    const keys = Array.from(
      new Set(result.map((row) => groupFields.map((f) => row[f]).join("|"))),
    );
    const finalRows: ReportRows = [];
    for (const key of keys) {
      const groupRows = result.filter(
        (row) => groupFields.map((f) => row[f]).join("|") === key,
      );
      const sortedGroup = [...groupRows].sort((a, b) => {
        for (const field of sortFields) {
          const va = a[field] || "";
          const vb = b[field] || "";
          if (va < vb) return -1;
          if (va > vb) return 1;
        }
        return 0;
      });
      finalRows.push(...sortedGroup);
    }
    return finalRows;
  }
  // simple global sort
  return [...result].sort((a, b) => {
    for (const field of sortFields) {
      const va = a[field] || "";
      const vb = b[field] || "";
      if (va < vb) return -1;
      if (va > vb) return 1;
    }
    return 0;
  });
}

export const RunReportInputSchema = z.object({
  reportId: z.number(),
  savedOnly: z
    .boolean()
    .optional()
    .describe(
      "Read-only mode: use the newest already SAVED snapshot of the report (any age, see savedAt) and never start a new generation in Planfix. Fails if the report has no saved snapshot",
    ),
  group: z.array(z.string()).optional(),
  groupPeriod: z.enum(["day", "week", "month"]).optional(),
  sort: z.array(z.string()).optional(),
});

export const RunReportOutputSchema = z.object({
  success: z.boolean(),
  rows: z.array(z.record(z.string())).optional(),
  rowCount: z.number().optional(),
  savedAt: z.string().optional().describe("When the used saved snapshot was created (savedOnly mode)"),
  error: z.string().optional(),
});

type GenerateReportResponse = {
  result: string;
  requestId: string;
};

type ReportStatusResponse = {
  result: string;
  status: "in_progress" | "ready";
  save?: {
    id: number;
    name: string;
    reportId: number;
    chunksCount?: number;
  };
};

type SavedReport = {
  id: number;
  dateTime?: { datetime?: string };
  chunksCount?: number;
};

const MAX_CHUNKS = 50;

type ReportRows = Array<Record<string, string>>;

interface PlanfixReportItem {
  type: string;
  items: Array<{ text: string }>;
}

type PlanfixReportData = PlanfixReportItem[];

function reportDataToRows(data: PlanfixReportData): ReportRows {
  if (!data) return [];
  const header = data.find((row) => row.type === "Header");
  if (!header) return [];
  const fieldNames = header.items.map((item) => item.text);

  return data
    .map((item) => {
      if (item.type !== "Normal") return null;
      const row: { [key: string]: string } = {};
      for (const i in fieldNames) {
        row[fieldNames[i]] = item.items[i]?.text || "";
      }
      return row;
    })
    .filter(Boolean) as ReportRows;
}

/** Reads every chunk of a saved report (`chunk` is a query parameter). */
async function readSaveData(
  reportId: number,
  saveId: number,
  chunksCount?: number,
): Promise<PlanfixReportData> {
  const chunks = Math.min(Math.max(chunksCount ?? 1, 1), MAX_CHUNKS);
  const data: PlanfixReportData = [];
  for (let chunk = 0; chunk < chunks; chunk++) {
    const res = (await planfixRequest({
      path: `report/${reportId}/save/${saveId}/data?chunk=${chunk}`,
      body: {},
    })) as { data?: { rows?: PlanfixReportData }; rows?: PlanfixReportData };
    data.push(...(res.data?.rows ?? res.rows ?? []));
  }
  return data;
}

async function generateReportUncached({
  reportId,
}: {
  reportId: number;
}): Promise<PlanfixReportData | { error: string }> {
  try {
    const generateResult = (await planfixRequest({
      path: `report/${reportId}/generate`,
      body: {},
    })) as GenerateReportResponse;

    // Poll for report completion (reports can take a while)
    const maxAttempts = 30;
    const delayMs = 2000;
    let reportData: PlanfixReportData | undefined;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));

      const statusResult = (await planfixRequest({
        path: `report/status/${generateResult.requestId}`,
        method: "GET",
      })) as ReportStatusResponse;

      if (statusResult.status === "ready" && statusResult.save) {
        reportData = await readSaveData(
          reportId,
          statusResult.save.id,
          statusResult.save.chunksCount,
        );
        break;
      } else if (statusResult.status !== "in_progress") {
        throw new Error(`Unexpected report status: ${statusResult.status}`);
      }
    }

    if (!reportData) {
      throw new Error("Report generation timed out");
    }

    return reportData;
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    log(`[generateReport] Error: ${errorMessage}`);
    return { error: errorMessage };
  }
}

async function generateReport({
  reportId,
}: {
  reportId: number;
}): Promise<PlanfixReportData | { error: string }> {
  const cacheKey = `${CACHE_PREFIX}${reportId}`;

  return withCache(
    cacheKey,
    async () => {
      // First, try to use a fresh saved snapshot
      const saved = await latestSavedReport({ reportId });
      if (saved && Date.now() - saved.savedAtMs < CACHE_TIME * 1000) {
        return readSaveData(reportId, saved.save.id, saved.save.chunksCount);
      }

      // Otherwise generate a new report
      return generateReportUncached({ reportId });
    },
    CACHE_TIME,
  );
}

/** Newest saved snapshot of a report (any age), or undefined. */
async function latestSavedReport({
  reportId,
}: {
  reportId: number;
}): Promise<{ save: SavedReport; savedAtMs: number } | undefined> {
  try {
    const data = (await planfixRequest({
      path: `report/${reportId}/save/list`,
      body: { fields: "id,reportId,dateTime,name,chunksCount" },
    })) as { saves?: SavedReport[] };
    const withTime = (data.saves ?? [])
      .map((save) => ({ save, savedAtMs: Date.parse(save.dateTime?.datetime ?? "") }))
      .filter((x) => Number.isFinite(x.savedAtMs));
    if (withTime.length === 0) return undefined;
    return withTime.reduce((a, b) => (b.savedAtMs > a.savedAtMs ? b : a));
  } catch (error) {
    log(
      "Exception when checking saved report: " +
        (error instanceof Error ? error.message : "Unknown error"),
    );
    return undefined;
  }
}

export async function runReport({
  reportId,
  savedOnly,
  group,
  groupPeriod,
  sort,
}: z.infer<typeof RunReportInputSchema>): Promise<
  z.infer<typeof RunReportOutputSchema>
> {
  try {
    if (savedOnly) {
      // Read-only: never triggers a new generation in Planfix.
      const saved = await latestSavedReport({ reportId });
      if (!saved) {
        return { success: false, error: "The report has no saved snapshot. Run it in Planfix once, or call without savedOnly" };
      }
      const data = await readSaveData(reportId, saved.save.id, saved.save.chunksCount);
      const rows = processRows(reportDataToRows(data), group, groupPeriod, sort);
      return {
        success: true,
        rows,
        rowCount: rows.length,
        savedAt: new Date(saved.savedAtMs).toISOString(),
      };
    }

    const reportDataOrError = await generateReport({ reportId });

    if ("error" in reportDataOrError) {
      return { success: false, error: reportDataOrError.error };
    }

    const rows = reportDataToRows(reportDataOrError);
    const processedRows = processRows(rows, group, groupPeriod, sort);
    return { success: true, rows: processedRows, rowCount: processedRows.length };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    log(`[runReport] Error: ${errorMessage}`);
    return { success: false, error: errorMessage };
  }
}

export async function handler(
  args?: Record<string, unknown>,
): Promise<z.infer<typeof RunReportOutputSchema>> {
  const parsedArgs = RunReportInputSchema.parse(args);
  return await runReport(parsedArgs);
}

export const planfixRunReportTool = getToolWithHandler({
  name: "planfix_run_report",
  description:
    "Run a Planfix report by ID and return its rows. By default it may start a new report generation in Planfix (creates a saved snapshot); pass savedOnly=true to only read the newest saved snapshot (strictly read-only).",
  inputSchema: RunReportInputSchema,
  outputSchema: RunReportOutputSchema,
  handler,
});

export default planfixRunReportTool;
