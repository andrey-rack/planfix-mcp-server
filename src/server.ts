import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { log } from "./helpers.js";
import { PLANFIX_ENABLE_RAW_REQUEST } from "./config.js";
import { ToolWithHandler } from "./types.js";

import planfix_add_to_lead_task from "./tools/planfix_add_to_lead_task.js";
import planfix_create_comment from "./tools/planfix_create_comment.js";
import planfix_create_contact from "./tools/planfix_create_contact.js";
import planfix_create_lead_task from "./tools/planfix_create_lead_task.js";
import planfix_create_sell_task from "./tools/planfix_create_sell_task.js";
import planfix_create_sell_task_ids from "./tools/planfix_create_sell_task_ids.js";
import planfix_create_general_task from "./tools/planfix_create_general_task.js";
import planfix_create_task from "./tools/planfix_create_task.js";
import planfix_get_child_tasks from "./tools/planfix_get_child_tasks.js";
import planfix_get_file from "./tools/planfix_get_file.js";
import planfix_get_contact from "./tools/planfix_get_contact.js";
import planfix_get_contact_comments from "./tools/planfix_get_contact_comments.js";
import planfix_get_report_fields from "./tools/planfix_get_report_fields.js";
import planfix_get_task from "./tools/planfix_get_task.js";
import planfix_get_task_analytic from "./tools/planfix_get_task_analytic.js";
import planfix_get_task_comments from "./tools/planfix_get_task_comments.js";
import planfix_list_contacts from "./tools/planfix_list_contacts.js";
import planfix_list_tasks from "./tools/planfix_list_tasks.js";
import planfix_reports_list from "./tools/planfix_reports_list.js";
import planfix_request from "./tools/planfix_request.js";
import planfix_run_report from "./tools/planfix_run_report.js";
import planfix_search_company from "./tools/planfix_search_company.js";
import planfix_search_contact from "./tools/planfix_search_contact.js";
import planfix_search_directory from "./tools/planfix_search_directory.js";
import planfix_search_directory_entry from "./tools/planfix_search_directory_entry.js";
import planfix_search_lead_task from "./tools/planfix_search_lead_task.js";
import planfix_search_manager from "./tools/planfix_search_manager.js";
import planfix_search_project from "./tools/planfix_search_project.js";
import planfix_search_task from "./tools/planfix_search_task.js";
import planfix_update_contact from "./tools/planfix_update_contact.js";
import planfix_update_lead_task from "./tools/planfix_update_lead_task.js";
import planfix_upload_file from "./tools/planfix_upload_file.js";
import { createWriteLimiter, maxWritesFromEnv } from "./lib/writeLimit.js";
import { SKILL_NOTICE, serverInstructions, skillInstalled } from "./lib/skillNotice.js";
import planfix_attach_file from "./tools/planfix_attach_file.js";
import planfix_create_project from "./tools/planfix_create_project.js";
import planfix_get_task_statuses from "./tools/planfix_get_task_statuses.js";
import planfix_update_comment from "./tools/planfix_update_comment.js";
import planfix_update_project from "./tools/planfix_update_project.js";
import planfix_update_task from "./tools/planfix_update_task.js";
import {
  planfixCreateChecklistItemTool as planfix_create_checklist_item,
  planfixGetTaskChecklistTool as planfix_get_task_checklist,
  planfixUpdateChecklistItemTool as planfix_update_checklist_item,
} from "./tools/planfix_checklist.js";

export const TOOLS: ToolWithHandler[] = [
  planfix_add_to_lead_task,
  planfix_create_comment,
  planfix_create_contact,
  planfix_create_lead_task,
  planfix_create_sell_task,
  planfix_create_sell_task_ids,
  planfix_create_general_task,
  planfix_create_task,
  planfix_get_child_tasks,
  planfix_get_contact,
  planfix_get_contact_comments,
  planfix_get_file,
  planfix_get_report_fields,
  planfix_get_task,
  planfix_get_task_analytic,
  planfix_get_task_comments,
  planfix_list_contacts,
  planfix_list_tasks,
  planfix_reports_list,
  planfix_request,
  planfix_run_report,
  planfix_search_company,
  planfix_search_contact,
  planfix_search_directory,
  planfix_search_directory_entry,
  planfix_search_lead_task,
  planfix_search_manager,
  planfix_search_project,
  planfix_search_task,
  planfix_update_contact,
  planfix_update_lead_task,
  planfix_upload_file,
  planfix_attach_file,
  planfix_create_checklist_item,
  planfix_create_project,
  planfix_get_task_checklist,
  planfix_get_task_statuses,
  planfix_update_checklist_item,
  planfix_update_comment,
  planfix_update_project,
  planfix_update_task,
];

// The raw API passthrough is disabled unless PLANFIX_ENABLE_RAW_REQUEST=1.
const activeTools = () =>
  TOOLS.filter(
    (t) => PLANFIX_ENABLE_RAW_REQUEST || t.name !== "planfix_request",
  );

const READ_ONLY_TOOLS = new Set(["planfix_reports_list", "planfix_run_report"]);
const READ_ONLY_PREFIXES = ["planfix_search_", "planfix_get_", "planfix_list_"];

// Hints let Claude clients ask for confirmation before write/destructive tools.
function annotationsFor(name: string) {
  const readOnly =
    READ_ONLY_TOOLS.has(name) ||
    READ_ONLY_PREFIXES.some((prefix) => name.startsWith(prefix));
  return {
    readOnlyHint: readOnly,
    destructiveHint:
      !readOnly && (name.startsWith("planfix_update_") || name === "planfix_request"),
  };
}

export function createPlanfixServer(): Server {
  const hasSkill = skillInstalled();
  const writeLimiter = createWriteLimiter(maxWritesFromEnv());
  let noticePending = !hasSkill; // show the "install the skill" hint once per session, in the first tool answer

  const server = new Server(
    {
      name: "planfix-mcp-server",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
      instructions: serverInstructions(hasSkill),
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: activeTools().map((t) => ({ ...t, annotations: annotationsFor(t.name) })),
    };
  });

  interface AnswerContent {
    type: string;
    text: string;
  }

  interface AnswerJson<T = unknown> {
    content: AnswerContent[];
    structuredContent: T;
  }

  function getAnswerJson<T = unknown>(data: T): AnswerJson<T> {
    const content: AnswerContent[] = [{ type: "text", text: JSON.stringify(data, null, 2) }];
    if (noticePending) {
      noticePending = false;
      content.push({ type: "text", text: SKILL_NOTICE });
    }
    return { structuredContent: data, content };
  }

  // @ts-expect-error - The SDK's type definitions are too strict for our use case
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    log(`Received tool call: ${name}`);
    try {
      const tool = activeTools().find((t) => t.name === name);
      if (!tool?.handler) {
        return getAnswerJson({ error: `Handler not found for tool: ${name}` });
      }
      if (!annotationsFor(name).readOnlyHint) {
        const refusal = writeLimiter.take();
        if (refusal) return getAnswerJson({ error: refusal });
      }
      return getAnswerJson(await tool.handler(args));
    } catch (error) {
      console.error(`Error calling tool ${name}:`, error);
      return getAnswerJson({
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  return server;
}
