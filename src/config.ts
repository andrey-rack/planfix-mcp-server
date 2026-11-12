import { fileURLToPath } from "url";
import path from "path";
import dotenv from "dotenv";
import fs from "fs";

// change cwd to current file directory before load .env
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
process.chdir(path.join(__dirname, ".."));
// Suppress dotenv stdout output to keep MCP stdio protocol clean
const _origWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = () => true;
dotenv.config();
process.stdout.write = _origWrite;

// Security: everything this server writes (logs, caches) must be private to the current user.
process.umask(0o077);
function restrictDataPermissions(dir: string) {
  try {
    fs.chmodSync(dir, 0o700);
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) restrictDataPermissions(full);
      else if (entry.isFile()) fs.chmodSync(full, 0o600);
    }
  } catch {
    // data dir does not exist yet
  }
}
restrictDataPermissions(path.join(process.cwd(), "data"));

// Planfix API configuration
export const PLANFIX_ACCOUNT = process.env.PLANFIX_ACCOUNT || "";
export const PLANFIX_TOKEN = process.env.PLANFIX_TOKEN || "";
// The account becomes part of the API host name: allow only a plain sub-domain label.
if (PLANFIX_ACCOUNT && !/^[a-z0-9-]+$/i.test(PLANFIX_ACCOUNT)) {
  throw new Error("Invalid PLANFIX_ACCOUNT: only letters, digits and '-' are allowed");
}
export const PLANFIX_BASE_URL = `https://${PLANFIX_ACCOUNT}.planfix.com/rest/`;
export const PLANFIX_HEADERS = {
  Authorization: `Bearer ${PLANFIX_TOKEN}`,
  Accept: "application/json",
  "Content-Type": "application/json",
};

const envFlag = (v?: string) =>
  ["1", "true", "yes"].includes((v || "").toLowerCase());
export const PLANFIX_DRY_RUN = envFlag(process.env.PLANFIX_DRY_RUN);
// Dangerous capabilities are OFF unless the user opts in explicitly.
export const PLANFIX_ENABLE_RAW_REQUEST = envFlag(
  process.env.PLANFIX_ENABLE_RAW_REQUEST,
);
export const PLANFIX_UPLOAD_DIR = process.env.PLANFIX_UPLOAD_DIR || "";

// Folder where planfix_get_file may save downloaded audio/text attachments. Disabled when empty.
export const PLANFIX_DOWNLOAD_DIR = process.env.PLANFIX_DOWNLOAD_DIR || "";
// Extra hosts (comma separated) Planfix may redirect file downloads to. The default is Planfix's own S3 bucket.
export const PLANFIX_DOWNLOAD_HOSTS = (process.env.PLANFIX_DOWNLOAD_HOSTS || "")
  .split(",")
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

export const PLANFIX_TASK_TITLE_TEMPLATE =
  process.env.PLANFIX_TASK_TITLE_TEMPLATE || "";

export const PLANFIX_FIELD_IDS = {
  email: Number(process.env.PLANFIX_FIELD_ID_EMAIL || 108),
  phone: Number(process.env.PLANFIX_FIELD_ID_PHONE || 105),
  telegram: process.env.PLANFIX_FIELD_ID_TELEGRAM_CUSTOM
    ? 0
    : Number(process.env.PLANFIX_FIELD_ID_TELEGRAM || 131),
  telegramCustom: Number(process.env.PLANFIX_FIELD_ID_TELEGRAM_CUSTOM),
  client: Number(process.env.PLANFIX_FIELD_ID_CLIENT),
  manager: Number(process.env.PLANFIX_FIELD_ID_MANAGER),
  agency: Number(process.env.PLANFIX_FIELD_ID_AGENCY),
  leadSource: Number(process.env.PLANFIX_FIELD_ID_LEAD_SOURCE),
  pipeline: Number(process.env.PLANFIX_FIELD_ID_PIPELINE),
  serviceMatrix: Number(process.env.PLANFIX_FIELD_ID_SERVICE_MATRIX),
  tags: Number(process.env.PLANFIX_FIELD_ID_TAGS),
  leadId: Number(process.env.PLANFIX_FIELD_ID_LEAD_ID),
};
