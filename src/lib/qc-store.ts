import { create } from "zustand";
import { persist } from "zustand/middleware";
import { INSPECTIONS, INSPECTORS, type Inspection } from "./qc-data";
import { SHEET_ENV_CONFIG, getSheetReadUrl, getSheetWriteUrl, hasSheetEnvConfig, readSheetRows, toSheetRowPayload, type SheetCrudAction } from "./google-sheet-sync";

export type DeviceStatus = "Pending" | "In Progress" | "Approved" | "Rejected";

export interface DeviceRow {
  deviceId: string;
  status: DeviceStatus;
  verdict?: "PASS" | "FAIL" | "PENDING";
  qcType?: string;
  slot?: number;
  inspectorId?: string;
  startTime?: number;
  endTime?: number;
  remarks?: string;
  rejectionReason?: string;
  actionBy?: string;
  actionAt?: number;
  preInspectionId?: string;
  postInspectionId?: string;
  version?: string;
  queuedByForm?: boolean;
}

export interface AuditEntry {
  id: string;
  ts: number;
  user: string;
  action: string;
  detail: string;
}

interface BulkSnapshot {
  before: DeviceRow[];
  label: string;
  ts: number;
}

interface SheetSyncState {
  readUrl: string;
  writeUrl: string;
  enabled: boolean;
  lastSyncAt?: number;
  lastError?: string;
  syncing: boolean;
  rawRowCount?: number;
  rawRows?: Array<Record<string, unknown>>;
}

interface State {
  devices: DeviceRow[];
  audit: AuditEntry[];
  currentUser: string;
  highlightedId?: string;
  lastBulk?: BulkSnapshot;
  sheetSync: SheetSyncState;
  setUser: (id: string) => void;
  upsertDevice: (id: string) => DeviceRow;
  startTimer: (id: string) => void;
  stopTimer: (id: string) => void;
  approve: (ids: string[], approvedAt?: number) => void;
  reject: (ids: string[], reason: string) => void;
  deleteDevice: (id: string) => void;
  updateRow: (id: string, patch: Partial<DeviceRow>) => void;
  highlight: (id?: string) => void;
  undoBulk: () => void;
  resetSeed: () => void;
  loadFromCSV: (rows: Array<Record<string, string>>) => void;
  setSheetSync: (patch: Partial<SheetSyncState>) => void;
  refreshFromSheet: () => Promise<void>;
}

function seedFromInspections(): DeviceRow[] {
  const map = new Map<string, DeviceRow>();
  for (const i of INSPECTIONS) {
    const existing = map.get(i.deviceId) ?? {
      deviceId: i.deviceId,
      status: "Pending" as DeviceStatus,
      verdict: "PENDING" as const,
      slot: i.slot,
    };
    if (i.qcType === "Pre") existing.preInspectionId = i.id;
    if (i.qcType === "Post") existing.postInspectionId = i.id;
    existing.inspectorId = i.inspectorId;
    existing.startTime = i.timestamp;
    existing.endTime = i.timestamp + i.durationSec * 1000;
    existing.qcType = existing.qcType
      ? existing.qcType.includes(i.qcType)
        ? existing.qcType
        : `${existing.qcType}, ${i.qcType}`
      : i.qcType;
    const failed = Object.values(i.results).some((r) => r === "FAIL");
    existing.status = i.qcType === "Pre" ? "Approved" : failed ? "Rejected" : "Approved";
    existing.verdict = i.qcType === "Pre" ? "PASS" : failed ? "FAIL" : "PASS";
    map.set(i.deviceId, existing);
  }
  // add a few pending
  for (let n = 0; n < 6; n++) {
    const id = `XLR-99${(10 + n).toString()}-N`;
    map.set(id, { deviceId: id, status: "Pending" });
  }
  return Array.from(map.values());
}

const uid = () => Math.random().toString(36).slice(2, 10);

function normalizeVerdict(status: DeviceStatus, verdict?: DeviceRow["verdict"]): DeviceRow["verdict"] {
  if (verdict) return verdict;
  if (status === "Approved") return "PASS";
  if (status === "Rejected") return "FAIL";
  return "PENDING";
}

function normalizeStatus(value: string): DeviceStatus {
  const upper = value.trim().toUpperCase();
  if (upper.includes("APPROV")) return "Approved";
  if (upper.includes("REJECT") || upper.includes("FAIL")) return "Rejected";
  if (upper.includes("IN PROGRESS")) return "In Progress";
  if (upper.includes("PEND")) return "Pending";
  return "Pending";
}

function parseTimestamp(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export function rowsToDevices(rows: Array<Record<string, string>>) {
  const map = new Map<string, DeviceRow>();
  for (const row of rows) {
    const id = String(row.DeviceID ?? row.device_id ?? row.deviceId ?? row.ID ?? "").trim();
    if (!id) continue;
    const status = normalizeStatus(String(row.Status || row.status || "Pending"));
    const existing = map.get(id) ?? { deviceId: id, status: "Pending" as DeviceStatus, verdict: "PENDING" };
    const slot = Number(row.Slot || row.slot);
    const startTime = parseTimestamp(row.StartTime || row.startTime);
    const endTime = parseTimestamp(row.EndTime || row.endTime);
    const actionAt = parseTimestamp(row.ActionAt || row.actionAt);
    let qcType = (row.QCType ?? row.qcType ?? row["QC Type"] ?? row.inspectionType) ? String(row.QCType ?? row.qcType ?? row["QC Type"] ?? row.inspectionType).trim() : undefined;
    if (qcType) {
      const low = qcType.toLowerCase();
      if (low.startsWith("pre")) qcType = "Pre";
      else if (low.startsWith("post")) qcType = "Post";
      else qcType = qcType.charAt(0).toUpperCase() + qcType.slice(1).toLowerCase();
    }
    const verdict = ((row.Verdict || row.verdict || row.Result || row.result || "") as string).toUpperCase();
    // Determine verdict canonical value
    const canonicalVerdict = verdict.includes("PASS") ? "PASS" : verdict.includes("FAIL") ? "FAIL" : undefined;

    // Decide status: Pre rows are always approved in the UI; Post rows follow PASS/FAIL.
    let finalStatus: DeviceStatus = status;
    if (qcType === "Pre") finalStatus = "Approved";
    else if (canonicalVerdict === "PASS") finalStatus = "Approved";
    else if (canonicalVerdict === "FAIL") finalStatus = "Rejected";

    map.set(id, {
      ...existing,
      deviceId: id,
      status: finalStatus,
      verdict:
        qcType === "Pre"
          ? "PASS"
          : canonicalVerdict
            ? (canonicalVerdict as DeviceRow['verdict'])
            : normalizeVerdict(finalStatus, existing.verdict),
      qcType: qcType || existing.qcType,
      remarks: row.Remarks || row.remarks || existing.remarks,
      rejectionReason: row.RejectionReason || row.reason || existing.rejectionReason,
      inspectorId: row.Inspector || row.inspector || row.inspectorName || row.InspectorName || row.ActionBy || row.actionBy || existing.inspectorId,
      slot: Number.isFinite(slot) && slot > 0 ? slot : existing.slot,
      startTime: startTime ?? existing.startTime,
      endTime: endTime ?? existing.endTime,
      actionBy: row.ActionBy || row.actionBy || existing.actionBy,
      actionAt: actionAt ?? parseTimestamp(row.submittedAt) ?? existing.actionAt,
      version: (String(row.Version ?? row.version ?? existing.version ?? "").trim() || undefined),
    });
  }
  return Array.from(map.values());
}

export function getLiveInspectorOptions(devices: DeviceRow[], fallbackIds: string[] = []) {
  const map = new Map<string, { id: string; name: string; role: string }>();

  for (const device of devices) {
    const id = String(device.inspectorId || device.actionBy || "").trim();
    if (!id || map.has(id)) continue;
    map.set(id, { id, name: id, role: "Inspector" });
  }

  for (const id of fallbackIds) {
    const trimmed = String(id || "").trim();
    if (!trimmed || map.has(trimmed)) continue;
    map.set(trimmed, { id: trimmed, name: trimmed, role: "Inspector" });
  }

  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function formatStatusLabel(status: DeviceStatus, qcType?: string) {
  if (status === "Approved" && qcType === "Pre") return "Pre Approved";
  if (status === "Approved" && qcType === "Post") return "Post Approved";
  if (status === "Approved") return "QC Approved";
  if (status === "Rejected" && qcType === "Post") return "Post Fail";
  if (status === "Rejected" && qcType === "Pre") return "Pre Approved";
  if (status === "Rejected") return "Fail";
  if (status === "Pending") return "Queued";
  return status;
}

async function syncSheetMutation(action: SheetCrudAction, row: DeviceRow) {
  const sync = useQC.getState().sheetSync;
  const writeUrl = getSheetWriteUrl(sync.writeUrl || SHEET_ENV_CONFIG.appScriptUrl);
  if (!sync.enabled || !writeUrl) return;
  
  try {
    // attach stored id token if available (Apps Script expects token param)
    const token = typeof window !== 'undefined' ? localStorage.getItem('qc-auth-user-token') : null;
    const hasQuery = writeUrl.includes('?');
    const url = token
      ? `${writeUrl}${hasQuery ? '&' : '?'}token=${encodeURIComponent(token)}`
      : import.meta.env.DEV
        ? `${writeUrl}${hasQuery ? '&' : '?'}dev=1`
        : writeUrl;

    await fetch(url, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, row: toSheetRowPayload(row) }),
    });
  } catch (error) {
    console.warn(`Sheet sync error: ${error instanceof Error ? error.message : String(error)}`);
    // Continue anyway - data is saved locally
  }
}

export const useQC = create<State>()(
  persist(
    (set, get) => ({
      devices: [],
      audit: [],
      currentUser: INSPECTORS[0].id,
      sheetSync: {
        readUrl: hasSheetEnvConfig() ? getSheetReadUrl() : "",
        writeUrl: SHEET_ENV_CONFIG.appScriptUrl,
        enabled: !!SHEET_ENV_CONFIG.appScriptUrl,
        syncing: false,
      },

      setUser: (id) => set({ currentUser: id }),

 

      setSheetSync: (patch) => set((s) => ({ sheetSync: { ...s.sheetSync, ...patch } })),

      refreshFromSheet: async () => {
        const sync = get().sheetSync;
        if (!sync.enabled && !sync.readUrl.trim() && !SHEET_ENV_CONFIG.appScriptUrl) return;
        set((s) => ({ sheetSync: { ...s.sheetSync, syncing: true, lastError: undefined } }));
        try {
          const result = await readSheetRows(sync.readUrl || SHEET_ENV_CONFIG.appScriptUrl);
          const fresh = rowsToDevices(result.rows);

          // Preserve locally-created pending / in-progress devices that may not yet exist in the sheet
          // Build a case-insensitive map so sheet rows override local rows even when ID casing differs
          const freshKeyMap = new Map<string, DeviceRow>();
          for (const d of fresh) freshKeyMap.set(String(d.deviceId).toLowerCase(), d);
          const local = get().devices;
          for (const d of local) {
            const key = String(d.deviceId).toLowerCase();
            // Auto-merge behavior: if this device was queued locally but the sheet
            // contains an authoritative row for it, replace the local queued row
            // with the sheet row (and clear the queued flag). Otherwise, if the
            // device is local pending/in-progress and absent from sheet, preserve it.
            if (d.queuedByForm && freshKeyMap.has(key)) {
              const authoritative = freshKeyMap.get(key)!;
              freshKeyMap.set(key, { ...authoritative, queuedByForm: false });
            } else if ((d.status === 'Pending' || d.status === 'In Progress') && !freshKeyMap.has(key)) {
              freshKeyMap.set(key, d);
            }
          }

          // If a sheet row exists with a final verdict (PASS/FAIL), ensure it's not treated as queued locally
          for (const [k, v] of Array.from(freshKeyMap.entries())) {
            if ((v.verdict ?? 'PENDING') !== 'PENDING') {
              // clear queued flag when sheet has a final verdict
              v.queuedByForm = false;
            }
          }

          set({
            devices: Array.from(freshKeyMap.values()),
            sheetSync: {
              ...get().sheetSync,
              syncing: false,
              lastSyncAt: Date.now(),
              lastError: undefined,
              rawRowCount: result.rawCount,
              rawRows: result.rawRows,
            },
          });
        } catch (error) {
          set((s) => ({
            sheetSync: {
              ...s.sheetSync,
              syncing: false,
              lastError: error instanceof Error ? error.message : "Sheet sync failed",
            },
          }));
        }
      },

      upsertDevice: (id) => {
        const existing = get().devices.find((d) => d.deviceId === id);
        if (existing) return existing;
        const row: DeviceRow = { deviceId: id, status: "Pending", verdict: "PENDING" };
        set((s) => ({
          devices: [row, ...s.devices],
          audit: [{ id: uid(), ts: Date.now(), user: s.currentUser, action: "CREATE", detail: id }, ...s.audit],
        }));
        void syncSheetMutation("create", row).catch(() => undefined);
        return row;
      },

      startTimer: (id) =>
        set((s) => ({
          devices: s.devices.map((d) =>
            d.deviceId === id && d.status !== "Approved" && d.status !== "Rejected"
              ? { ...d, status: "In Progress", startTime: d.startTime ?? Date.now(), endTime: undefined }
              : d
          ),
          audit: [{ id: uid(), ts: Date.now(), user: s.currentUser, action: "START", detail: id }, ...s.audit],
        })),

      stopTimer: (id) =>
        set((s) => ({
          devices: s.devices.map((d) => (d.deviceId === id ? { ...d, endTime: Date.now() } : d)),
        })),

      approve: (ids, approvedAt) =>
        set((s) => {
          const before = s.devices.filter((d) => ids.includes(d.deviceId)).map((d) => ({ ...d }));
          const now = approvedAt ?? Date.now();
          const nextDevices = s.devices.map((d) =>
            ids.includes(d.deviceId)
              ? {
                  ...d,
                  status: "Approved" as DeviceStatus,
                  verdict: "PASS" as const,
                  endTime: d.endTime ?? now,
                  startTime: d.startTime ?? now - 30000,
                  actionBy: s.currentUser,
                  actionAt: now,
                  rejectionReason: undefined,
                }
              : d
          );
          nextDevices
            .filter((d) => ids.includes(d.deviceId))
            .forEach((row) => void syncSheetMutation("update", row).catch(() => undefined));
          return {
            devices: nextDevices,
            audit: [
              { id: uid(), ts: now, user: s.currentUser, action: "APPROVE", detail: ids.join(", ") },
              ...s.audit,
            ],
            lastBulk: { before, label: `Approved ${ids.length}`, ts: now },
          };
        }),

      reject: (ids, reason) =>
        set((s) => {
          const before = s.devices.filter((d) => ids.includes(d.deviceId)).map((d) => ({ ...d }));
          const now = Date.now();
          const nextDevices = s.devices.map((d) =>
            ids.includes(d.deviceId)
              ? {
                  ...d,
                  status: "Rejected" as DeviceStatus,
                  verdict: "FAIL" as const,
                  endTime: d.endTime ?? now,
                  startTime: d.startTime ?? now - 30000,
                  actionBy: s.currentUser,
                  actionAt: now,
                  rejectionReason: reason,
                }
              : d
          );
          nextDevices
            .filter((d) => ids.includes(d.deviceId))
            .forEach((row) => void syncSheetMutation("update", row).catch(() => undefined));
          return {
            devices: nextDevices,
            audit: [
              { id: uid(), ts: now, user: s.currentUser, action: "REJECT", detail: `${ids.join(", ")} — ${reason}` },
              ...s.audit,
            ],
            lastBulk: { before, label: `Rejected ${ids.length}`, ts: now },
          };
        }),

      deleteDevice: (id) =>
        set((s) => {
          const existing = s.devices.find((d) => d.deviceId === id);
          if (!existing) return s;
          void syncSheetMutation("delete", existing).catch(() => undefined);
          return {
            devices: s.devices.filter((d) => d.deviceId !== id),
            audit: [{ id: uid(), ts: Date.now(), user: s.currentUser, action: "DELETE", detail: id }, ...s.audit],
          };
        }),

      updateRow: (id, patch) =>
        set((s) => {
          const next = s.devices.map((d) =>
            d.deviceId === id ? { ...d, ...patch, verdict: normalizeVerdict((patch.status ?? d.status) as DeviceStatus, patch.verdict ?? d.verdict) } : d
          );
          const row = next.find((d) => d.deviceId === id);
          if (row) void syncSheetMutation("update", row).catch(() => undefined);
          return { devices: next };
        }),

      highlight: (id) => set({ highlightedId: id }),

      undoBulk: () =>
        set((s) => {
          if (!s.lastBulk) return s;
          const map = new Map(s.lastBulk.before.map((d) => [d.deviceId, d]));
          return {
            devices: s.devices.map((d) => map.get(d.deviceId) ?? d),
            audit: [
              { id: uid(), ts: Date.now(), user: s.currentUser, action: "UNDO", detail: s.lastBulk.label },
              ...s.audit,
            ],
            lastBulk: undefined,
          };
        }),

      resetSeed: () => set({ devices: [], audit: [], lastBulk: undefined }),

      loadFromCSV: (rows) =>
        set((s) => {
          const map = new Map(s.devices.map((d) => [d.deviceId, d]));
          for (const r of rowsToDevices(rows)) {
            const existing = map.get(r.deviceId);
            map.set(r.deviceId, existing ? { ...existing, ...r } : r);
          }
          return {
            devices: Array.from(map.values()),
            audit: [
              { id: uid(), ts: Date.now(), user: s.currentUser, action: "IMPORT", detail: `${rows.length} rows from sheet` },
              ...s.audit,
            ],
          };
        }),
    }),
    { name: "qc-store-v1" }
  )
);

export const STATUS_RANK: Record<DeviceStatus, number> = {
  Rejected: 0,
  "In Progress": 1,
  Pending: 2,
  Approved: 3,
};

export const fmtDuration = (ms: number) => {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}m ${r}s` : `${r}s`;
};

export const perfBucket = (ms: number): "fast" | "avg" | "slow" => {
  const s = ms / 1000;
  if (s < 30) return "fast";
  if (s < 60) return "avg";
  return "slow";
};

// Expose dev helpers in development only
if (typeof window !== "undefined") {
  try {
    const devMode = typeof window !== "undefined" && typeof window.location !== "undefined" && /localhost|127\.0\.0\.1/.test(window.location.hostname);
    if (devMode) {
      const w = window as unknown as Record<string, unknown>;
      w.__QC__ = {
        getState: useQC.getState,
        subscribe: useQC.subscribe,
        refreshFromSheet: () => useQC.getState().refreshFromSheet(),
        clearQueued: (id: string) => useQC.getState().updateRow(id, { queuedByForm: false }),
        list: () => useQC.getState().devices,
      } as unknown;
    }
  } catch (e) {
    // ignore
  }
}
