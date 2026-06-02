import Papa from "papaparse";
import { TESTS, type QCType } from "./qc-data";

export const SHEET_REFRESH_MS = 30_000;

export interface SheetEnvConfig {
  appScriptUrl: string;
  readUrl: string;
  writeUrl: string;
}

export const SHEET_ENV_CONFIG: SheetEnvConfig = {
  appScriptUrl: import.meta.env.VITE_APP_SCRIPT_URL?.trim() ?? "",
  readUrl: import.meta.env.VITE_APP_SCRIPT_URL?.trim() ?? "",
  writeUrl: import.meta.env.VITE_APP_SCRIPT_URL?.trim() ?? "",
};

export type SheetCrudAction = "create" | "update" | "delete";

export interface SheetColumnDef {
  key: string;
  label: string;
  description: string;
  required?: boolean;
  derived?: boolean;
}

export const SHEET_COLUMNS: SheetColumnDef[] = [
  {
    key: "DeviceID",
    label: "Device ID",
    description: "Unique queue/device identifier used to upsert rows.",
    required: true,
  },
  {
    key: "Status",
    label: "Status",
    description: "Queue status such as Pending, In Progress, Approved, or Rejected.",
    required: true,
  },
  {
    key: "Verdict",
    label: "Verdict",
    description: "Derived PASS / FAIL / PENDING value based on sheet tests or status.",
    derived: true,
  },
  {
    key: "QCType",
    label: "QC Type",
    description: "Inspection mode. Usually Pre, Post, or a combined value like Pre, Post.",
  },
  {
    key: "Inspector",
    label: "Inspector",
    description: "Inspector id or display name responsible for the row.",
  },
  {
    key: "Slot",
    label: "Slot",
    description: "Optional slot or station number.",
  },
  {
    key: "StartTime",
    label: "Start Time",
    description: "Start timestamp in ms or ISO text.",
  },
  {
    key: "EndTime",
    label: "End Time",
    description: "End timestamp in ms or ISO text.",
  },
  {
    key: "Remarks",
    label: "Remarks",
    description: "Freeform notes attached to the device or inspection.",
  },
  {
    key: "RejectionReason",
    label: "Rejection Reason",
    description: "Required when a row is rejected.",
  },
  {
    key: "ActionBy",
    label: "Action By",
    description: "User or inspector who last changed the row.",
  },
  {
    key: "ActionAt",
    label: "Action At",
    description: "Last action timestamp in ms or ISO text.",
  },
  {
    key: "UpdatedAt",
    label: "Updated At",
    description: "Optional sync timestamp if your sheet stores it.",
  },
  {
    key: "Version",
    label: "Version",
    description: "Device version or firmware version for filtering and tracking.",
  },
];

const normalizeKey = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");

const getValue = (row: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const match = Object.entries(row).find(([rowKey]) => normalizeKey(rowKey) === normalizeKey(key));
    const value = match?.[1];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
};

const toMs = (value: string) => {
  if (!value.trim()) return undefined;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
};

export function hasSheetEnvConfig() {
  return Boolean(SHEET_ENV_CONFIG.appScriptUrl);
}

export function toCsvUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  const sheetMatch = trimmed.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (!sheetMatch) return trimmed;
  const gid = trimmed.match(/[?&#]gid=(\d+)/)?.[1] ?? "0";
  return `https://docs.google.com/spreadsheets/d/${sheetMatch[1]}/export?format=csv&gid=${gid}`;
}

export function getSheetReadUrl(overrideUrl?: string) {
  if (import.meta.env.DEV) {
    return "/sheet-data";
  }

  const trimmed = overrideUrl?.trim() ?? "";
  if (trimmed) {
    // Don't convert Apps Script URLs
    if (trimmed.includes('script.google.com')) return trimmed;
    return toCsvUrl(trimmed);
  }
  if (SHEET_ENV_CONFIG.readUrl) {
    // Don't convert Apps Script URLs
    if (SHEET_ENV_CONFIG.readUrl.includes('script.google.com')) return SHEET_ENV_CONFIG.readUrl;
    return toCsvUrl(SHEET_ENV_CONFIG.readUrl);
  }
  throw new Error("Set VITE_APP_SCRIPT_URL in .env");
}

export function getSheetWriteUrl(overrideUrl?: string) {
  // If an explicit override is provided, honor it first (useful when callers pass API_URL)
  const trimmed = overrideUrl?.trim() ?? "";
  if (trimmed) return trimmed;

  // In development, default to the local proxy read endpoint only when no write URL is configured.
  // Posting to `/sheet-data` is a read-only test proxy; avoid sending writes there by default.
  if (import.meta.env.DEV && !SHEET_ENV_CONFIG.writeUrl) {
    return "/sheet-data";
  }

  return SHEET_ENV_CONFIG.writeUrl;
}

export function getSheetSourceSummary() {
  if (SHEET_ENV_CONFIG.appScriptUrl) {
    return "Apps Script API · env";
  }
  return "No data source configured (missing VITE_APP_SCRIPT_URL)";
}

export interface SheetReadResult {
  rows: Array<Record<string, string>>;
  rawRows: Array<Record<string, unknown>>;
  rawCount: number;
}

export function deriveVerdict(row: Record<string, unknown>): "PASS" | "FAIL" | "PENDING" {
  // Priority 1: Check explicit Verdict/Result field (treat explicit verdict as authoritative)
  const explicit = getValue(row, ["Verdict", "verdict", "Result", "result", "Outcome", "PassFail"]);
  if (explicit) {
    const upper = explicit.toUpperCase();
    if (upper.includes("PASS")) return "PASS";
    if (upper.includes("FAIL") || upper.includes("REJECT")) return "FAIL";
  }

  // Priority 2: Check explicit Status field
  const status = getValue(row, ["Status"]);
  if (status) {
    const upper = status.toUpperCase();
    if (upper.includes("APPROV")) return "PASS";
    if (upper.includes("REJECT")) return "FAIL";
    if (upper.includes("FAIL")) return "FAIL";
    if (upper.includes("PEND")) return "PENDING";
    if (upper.includes("PROGRESS")) return "PENDING";
  }

  // Priority 3: Check test columns for failures
  let hasTestData = false;
  for (const test of TESTS) {
    const value = getValue(row, [test.code, test.name, `pre_${test.code}`, `post_${test.code}`]);
    if (!value) continue;
    hasTestData = true;
    const upper = value.toUpperCase();
    if (upper.includes("FAIL") || upper.includes("NG") || upper.includes("REJECT")) return "FAIL";
  }

  // If we found test data with no failures, mark as PASS; otherwise PENDING
  return hasTestData ? "PASS" : "PENDING";
}

export function normalizeSheetRows(rows: Array<Record<string, unknown>>) {
  return rows
    .map((row) => {
      const deviceId = getValue(row, ["DeviceID", "deviceId", "Device ID", "ID", "device_id"]);
      if (!deviceId) return null;

      const verdict = deriveVerdict(row);
      const status =
        normalizeStatus(getValue(row, ["Status", "status"])) ||
        (verdict === "PASS" ? "Approved" : verdict === "FAIL" ? "Rejected" : "Pending");
      const qcType = normalizeQCType(getValue(row, ["QCType", "QC Type", "qcType", "Type", "inspectionType"]));
      const inspector = getValue(row, ["Inspector", "inspector", "InspectorID", "Inspector Id", "inspectorName"]);
      const slot = getValue(row, ["Slot", "slot"]);
      const remarks = getValue(row, ["Remarks", "remarks", "Note", "Notes"]);
      const rejectionReason = getValue(row, ["RejectionReason", "rejectionReason", "Reason", "reason"]);
      const actionBy = getValue(row, ["ActionBy", "actionBy", "UpdatedBy", "updatedBy"]);
      const actionAt = getValue(row, ["ActionAt", "actionAt", "UpdatedAt", "updatedAt", "submittedAt"]);
      const startTime = getValue(row, ["StartTime", "startTime", "StartedAt"]);
      const endTime = getValue(row, ["EndTime", "endTime", "FinishedAt"]);
      const version = getValue(row, ["Version", "version", "FirmwareVersion", "Firmware"]);

      const normalized: Record<string, string> = {
        DeviceID: deviceId,
        Status: status,
        Verdict: verdict,
      };

      if (qcType) normalized.QCType = qcType;
      if (inspector) normalized.Inspector = inspector;
      if (slot) normalized.Slot = slot;
      if (remarks) normalized.Remarks = remarks;
      if (rejectionReason) normalized.RejectionReason = rejectionReason;
      if (actionBy) normalized.ActionBy = actionBy;
      if (actionAt) normalized.ActionAt = String(toMs(actionAt) ?? actionAt);
      if (startTime) normalized.StartTime = String(toMs(startTime) ?? startTime);
      if (endTime) normalized.EndTime = String(toMs(endTime) ?? endTime);
      if (version) normalized.Version = version;

      return normalized;
    })
    .filter((row): row is Record<string, string> => Boolean(row));
}

function normalizeStatus(value: string) {
  const upper = value.trim().toUpperCase();
  if (!upper) return "";
  if (upper.includes("APPROV")) return "Approved";
  if (upper.includes("REJECT") || upper.includes("FAIL")) return "Rejected";
  if (upper.includes("IN PROGRESS")) return "In Progress";
  if (upper.includes("PEND") || upper.includes("PROGRESS")) return "Pending";
  return value;
}

function normalizeQCType(value: string) {
  const upper = value.trim().toUpperCase();
  if (!upper) return "";
  if (upper.startsWith("PRE")) return "Pre";
  if (upper.startsWith("POST")) return "Post";
  return value;
}

function normalizeSheetValues(values: unknown[][]) {
  if (!values.length) return [] as Array<Record<string, unknown>>;
  const [headers, ...rows] = values;
  return rows
    .filter((row) => row.some((cell) => String(cell ?? "").trim().length > 0))
    .map((row) =>
      headers.reduce<Record<string, unknown>>((acc, header, index) => {
        const key = String(header ?? "").trim();
        if (!key) return acc;
        acc[key] = row[index] ?? "";
        return acc;
      }, {})
    );
}

export async function readSheetRows(sourceUrl?: string) {
  const url = getSheetReadUrl(sourceUrl);
  const isAppsScript = url.includes("script.google.com");

  const response = await fetch(url, {
    cache: "no-store",
    mode: isAppsScript ? "cors" : "same-origin",
    credentials: isAppsScript ? "omit" : "include",
    headers: {
      "Accept": "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`Sheet fetch failed (${response.status})`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();
  if (contentType.includes("application/json") || text.trim().startsWith("{")) {
    const body = JSON.parse(text) as unknown;
    if (body && typeof body === "object" && Array.isArray((body as { values?: unknown[][] }).values)) {
      const rawRows = normalizeSheetValues((body as { values: unknown[][] }).values);
      return { rows: normalizeSheetRows(rawRows), rawRows, rawCount: rawRows.length };
    }
    if (body && typeof body === "object" && Array.isArray((body as { data?: unknown[] }).data)) {
      const rawRows = (body as { data: Array<Record<string, unknown>> }).data;
      return { rows: normalizeSheetRows(rawRows), rawRows, rawCount: rawRows.length };
    }
    if (Array.isArray(body)) {
      const rawRows = body as Array<Record<string, unknown>>;
      return { rows: normalizeSheetRows(rawRows), rawRows, rawCount: rawRows.length };
    }
    if (body && typeof body === "object" && Array.isArray((body as { rows?: unknown[] }).rows)) {
      const rawRows = (body as { rows: Array<Record<string, unknown>> }).rows;
      return { rows: normalizeSheetRows(rawRows), rawRows, rawCount: rawRows.length };
    }
    throw new Error("Unsupported JSON sheet payload");
  }

  const parsed = Papa.parse<Record<string, unknown>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
  });

  if (parsed.errors.length > 0 && parsed.data.length === 0) {
    throw new Error(parsed.errors[0]?.message ?? "Failed to parse sheet data");
  }

  const rawRows = parsed.data as Array<Record<string, unknown>>;
  return { rows: normalizeSheetRows(rawRows), rawRows, rawCount: rawRows.length };
}

export async function writeSheetRow(
  writeUrl: string,
  action: SheetCrudAction,
  row: Record<string, unknown>
) {
  const isAppsScript = writeUrl.includes('script.google.com');
  
  const response = await fetch(writeUrl, {
    method: "POST",
    mode: "cors",
    credentials: isAppsScript ? 'omit' : 'include',
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify({ action, row }),
  });

  if (!response.ok) {
    throw new Error(`Sheet write failed (${response.status})`);
  }

  return response;
}

export function toSheetRowPayload(row: {
  deviceId: string;
  status: string;
  qcType?: string;
  inspectorId?: string;
  slot?: number;
  startTime?: number;
  endTime?: number;
  remarks?: string;
  rejectionReason?: string;
  actionBy?: string;
  actionAt?: number;
  verdict?: string;
}) {
  return {
    DeviceID: row.deviceId,
    Status: row.status,
    Verdict: row.verdict ?? deriveVerdict({ Status: row.status }),
    QCType: row.qcType,
    Inspector: row.inspectorId,
    Slot: row.slot?.toString(),
    StartTime: row.startTime?.toString(),
    EndTime: row.endTime?.toString(),
    Remarks: row.remarks,
    RejectionReason: row.rejectionReason,
    ActionBy: row.actionBy,
    ActionAt: row.actionAt?.toString(),
  };
}

export function deriveDeviceVerdict(status: string, verdict?: string) {
  const normalized = (verdict ?? status).toUpperCase();
  if (normalized.includes("PASS") || normalized.includes("APPROV")) return "PASS";
  if (normalized.includes("FAIL") || normalized.includes("REJECT")) return "FAIL";
  return "PENDING";
}

export function isQCType(value: string): value is QCType {
  return value === "Pre" || value === "Post";
}
