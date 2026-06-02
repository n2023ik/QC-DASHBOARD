import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownUp,
  CheckCircle2,
  Filter,
  PackagePlus,
  QrCode,
  RotateCcw,
  Search,
  Sheet as SheetIcon,
  Undo2,
  XCircle,
  Trash2,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  STATUS_RANK,
  fmtDuration,
  perfBucket,
  getLiveInspectorOptions,
  useQC,
  type DeviceRow,
  type DeviceStatus,
} from "@/lib/qc-store";
import { SHEET_COLUMNS, SHEET_ENV_CONFIG, SHEET_REFRESH_MS, getSheetSourceSummary, hasSheetEnvConfig } from "@/lib/google-sheet-sync";
import { promptApprovalTimestamp } from "@/lib/approval-timestamp";
import { QRScanner } from "./QRScanner";
import { BulkConfirm } from "./BulkConfirm";

const STATUSES: (DeviceStatus | "All")[] = ["All", "Rejected", "In Progress", "Pending", "Approved"];
function statusFilterLabel(status: DeviceStatus | "All") {
  if (status === "Approved") return "QC Approved";
  if (status === "Rejected") return "Fail";
  if (status === "Pending") return "Queued";
  return status;
}
type SortKey = "status" | "latest" | "duration";

export function DeviceGrid() {
  const devices = useQC((s) => s.devices);
  const highlightedId = useQC((s) => s.highlightedId);
  const lastBulk = useQC((s) => s.lastBulk);
  const currentUser = useQC((s) => s.currentUser);
  const sheetSync = useQC((s) => s.sheetSync);
  const inspectorOptions = useMemo(() => getLiveInspectorOptions(devices, [currentUser]), [devices, currentUser]);
  const {
    upsertDevice,
    startTimer,
    approve,
    reject,
    updateRow,
    deleteDevice,
    highlight,
    undoBulk,
    resetSeed,
    setUser,
    setSheetSync,
    refreshFromSheet,
  } = useQC.getState();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<DeviceStatus | "All">("All");
  const [reasonFilter, setReasonFilter] = useState<string>("All");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("status");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [confirm, setConfirm] = useState<null | "approve" | "reject">(null);
  const [now, setNow] = useState(Date.now());
  const [sheetTab, setSheetTab] = useState<"settings" | "columns">("settings");
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!highlightedId) return;
    rowRefs.current[highlightedId]?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlightedId]);

  const reasons = useMemo(() => {
    const set = new Set<string>();
    devices.forEach((d) => d.rejectionReason && set.add(d.rejectionReason));
    return ["All", ...Array.from(set)];
  }, [devices]);

  const filtered = useMemo(() => {
    let rows = [...devices];
    if (statusFilter !== "All") rows = rows.filter((d) => d.status === statusFilter);
    if (reasonFilter !== "All") rows = rows.filter((d) => d.rejectionReason === reasonFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (d) =>
          d.deviceId.toLowerCase().includes(q) ||
          (d.remarks ?? "").toLowerCase().includes(q) ||
          (d.rejectionReason ?? "").toLowerCase().includes(q)
      );
    }
    // Always pin Rejected at top
    rows.sort((a, b) => {
      if (a.status === "Rejected" && b.status !== "Rejected") return -1;
      if (b.status === "Rejected" && a.status !== "Rejected") return 1;
      if (sort === "status") return STATUS_RANK[a.status] - STATUS_RANK[b.status];
      if (sort === "latest") return (b.actionAt ?? b.startTime ?? 0) - (a.actionAt ?? a.startTime ?? 0);
      if (sort === "duration") return durationOf(b, now) - durationOf(a, now);
      return 0;
    });
    return rows;
  }, [devices, statusFilter, reasonFilter, search, sort, now]);

  const allSelected = filtered.length > 0 && filtered.every((d) => selected.has(d.deviceId));
  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(filtered.map((d) => d.deviceId)));
  };
  const toggleOne = (id: string) => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const onScan = (text: string) => {
    setScannerOpen(false);
    const id = text.trim();
    upsertDevice(id);
    startTimer(id);
    highlight(id);
    setSearch("");
    setStatusFilter("All");
    setTimeout(() => highlight(undefined), 4000);
  };

  const handleConfirm = (mode: "approve" | "reject") => (reason?: string) => {
    const ids = Array.from(selected);
    if (mode === "approve") {
      const approvedAt = promptApprovalTimestamp("Enter approval timestamp before approving these devices");
      if (!approvedAt) return;
      approve(ids, approvedAt);
    }
    else if (reason) reject(ids, reason);
    setSelected(new Set());
    setConfirm(null);
  };

  const runSheetFetch = async () => {
    setSheetSync({ enabled: true });
    await refreshFromSheet();
  };

  return (
    <div className="mx-auto max-w-[1400px] space-y-4 px-4 py-6 sm:px-6">
      {/* Toolbar */}
      <div className="surface flex flex-wrap items-center gap-3 p-4">
        <div className="flex items-center gap-2">
          <SheetIcon className="h-4 w-4" />
          <h2 className="font-semibold">Devices</h2>
          <span className="label-mono">{filtered.length} shown · {devices.length} total</span>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search ID / remarks"
              className="w-44 rounded-md border border-input bg-background py-1.5 pl-7 pr-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <select
            value={currentUser}
            onChange={(e) => setUser(e.target.value)}
            className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            title="Acting as"
          >
            {inspectorOptions.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name} · {i.id}
              </option>
            ))}
          </select>

          <button
            onClick={() => setScannerOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            <QrCode className="h-4 w-4" /> Scan
          </button>
          <button
            onClick={() => {
              const id = `XLR-${Math.floor(1000 + Math.random() * 8999)}-N`;
              upsertDevice(id);
              highlight(id);
              setTimeout(() => highlight(undefined), 3000);
            }}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted"
          >
            <PackagePlus className="h-4 w-4" /> New
          </button>
          <button
            onClick={resetSeed}
            title="Reset to seed data"
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-sm hover:bg-muted"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Google Sheet import */}
      <div className="surface space-y-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <SheetIcon className="h-4 w-4 text-info" />
          <span className="label-mono">Google Sheet Sync</span>
          <span className="text-xs text-muted-foreground">Fetch every {SHEET_REFRESH_MS / 1000}s when enabled</span>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSheetTab("settings")}
              className={cn(
                "rounded-md border px-2.5 py-1 text-xs font-medium",
                sheetTab === "settings"
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground"
              )}
            >
              Settings
            </button>
            <button
              type="button"
              onClick={() => setSheetTab("columns")}
              className={cn(
                "rounded-md border px-2.5 py-1 text-xs font-medium",
                sheetTab === "columns"
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground"
              )}
            >
              Columns
            </button>
          </div>
        </div>

        {sheetTab === "settings" ? (
          <>
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm">
              <div>
                <div className="label-mono">Active data source</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {getSheetSourceSummary()}
                </div>
              </div>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-info/10 px-2 py-1 text-[11px] font-semibold text-info">
                  {sheetSync.syncing ? "Live sync running" : "Live data ready"}
                </span>
                <span className="rounded-full bg-muted px-2 py-1 text-[11px] font-semibold text-muted-foreground">
                  {devices.length} rows in UI
                </span>
                <button
                  type="button"
                  onClick={() => setSheetSync({ enabled: !sheetSync.enabled })}
                  className={cn(
                    "rounded-md border px-3 py-1.5 text-sm font-medium",
                    sheetSync.enabled
                      ? "border-success bg-success/10 text-success"
                      : "border-border bg-card text-muted-foreground"
                  )}
                >
                  {sheetSync.enabled ? "Sync on" : "Sync off"}
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <button
                type="button"
                onClick={runSheetFetch}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 font-medium hover:bg-muted"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Fetch now
              </button>
              <span className="label-mono">
                {sheetSync.syncing ? "Syncing..." : sheetSync.lastSyncAt ? `Last sync ${fmtDuration(now - sheetSync.lastSyncAt)} ago` : "No sync yet"}
              </span>
              {sheetSync.lastError ? <span className="text-destructive">{sheetSync.lastError}</span> : null}
            </div>
          </>
        ) : (
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
            {SHEET_COLUMNS.map((column) => (
              <div key={column.key} className="rounded-md border border-border bg-card p-2">
                <div className="flex items-center gap-2">
                  <span className="label-mono">{column.key}</span>
                  {column.required && <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold text-destructive">Required</span>}
                  {column.derived && <span className="rounded-full bg-info/10 px-2 py-0.5 text-[10px] font-semibold text-info">Derived</span>}
                </div>
                <div className="mt-1 text-sm font-medium">{column.label}</div>
                <div className="mt-1 text-xs text-muted-foreground">{column.description}</div>
              </div>
            ))}
          </div>
        )}

        {!hasSheetEnvConfig() && (
          <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
            Set VITE_APP_SCRIPT_URL in .env to enable sheet reads and writes.
          </div>
        )}
      </div>

      {/* Filters / sort / bulk */}
      <div className="surface flex flex-wrap items-center gap-2 p-3">
        <Filter className="h-3.5 w-3.5 text-muted-foreground" />
        {STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={cn(
              "rounded-md border px-2.5 py-1 text-xs font-medium transition",
              statusFilter === s
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground hover:text-foreground"
            )}
          >
            {statusFilterLabel(s)}
          </button>
        ))}

        <span className="mx-2 h-4 w-px bg-border" />

        <select
          value={reasonFilter}
          onChange={(e) => setReasonFilter(e.target.value)}
          className="rounded-md border border-input bg-background px-2 py-1 text-xs"
          title="Filter by rejection reason"
        >
          {reasons.map((r) => (
            <option key={r} value={r}>
              Reason: {r}
            </option>
          ))}
        </select>

        <span className="mx-2 h-4 w-px bg-border" />

        <ArrowDownUp className="h-3.5 w-3.5 text-muted-foreground" />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="rounded-md border border-input bg-background px-2 py-1 text-xs"
        >
          <option value="status">Status priority</option>
          <option value="latest">Latest activity</option>
          <option value="duration">Time taken</option>
        </select>

        <div className="ml-auto flex items-center gap-2">
          {lastBulk && (
            <button
              onClick={undoBulk}
              className="inline-flex items-center gap-1 rounded-md border border-info/40 bg-info/10 px-2.5 py-1 text-xs font-medium text-info hover:bg-info/20"
            >
              <Undo2 className="h-3 w-3" /> Undo {lastBulk.label}
            </button>
          )}
          <button
            disabled={selected.size === 0}
            onClick={() => setConfirm("approve")}
            className="inline-flex items-center gap-1 rounded-md bg-success px-3 py-1.5 text-xs font-semibold text-success-foreground disabled:opacity-40"
          >
            <CheckCircle2 className="h-3.5 w-3.5" /> Approve ({selected.size})
          </button>
          <button
            disabled={selected.size === 0}
            onClick={() => setConfirm("reject")}
            className="inline-flex items-center gap-1 rounded-md bg-destructive px-3 py-1.5 text-xs font-semibold text-destructive-foreground disabled:opacity-40"
          >
            <XCircle className="h-3.5 w-3.5" /> Reject ({selected.size})
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="surface overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
          <span className="label-mono">Showing: {getSheetSourceSummary()}</span>
          <span className="label-mono">{filtered.length} visible · {devices.length} total</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-left">
              <tr className="border-b border-border">
                <Th className="w-8">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="h-3.5 w-3.5 accent-primary"
                  />
                </Th>
                <Th>Device ID</Th>
                <Th>Status</Th>
                <Th>Verdict</Th>
                <Th>QC Type</Th>
                <Th>Inspector</Th>
                <Th>Start</Th>
                <Th>End</Th>
                <Th>Duration</Th>
                <Th>Remarks</Th>
                <Th>Reason</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => {
                const dur = durationOf(d, now);
                const bucket = dur > 0 ? perfBucket(dur) : null;
                const isHighlighted = highlightedId === d.deviceId;
                const isRejected = d.status === "Rejected";
                return (
                  <tr
                    key={d.deviceId}
                    ref={(el) => {
                      rowRefs.current[d.deviceId] = el;
                    }}
                    className={cn(
                      "border-b border-border transition",
                      isRejected && "bg-destructive/5",
                      isHighlighted && "bg-info/15 ring-2 ring-info animate-pulse",
                      !isRejected && !isHighlighted && "hover:bg-muted/40"
                    )}
                  >
                    <Td>
                      <input
                        type="checkbox"
                        checked={selected.has(d.deviceId)}
                        onChange={() => toggleOne(d.deviceId)}
                        className="h-3.5 w-3.5 accent-primary"
                      />
                    </Td>
                    <Td className="font-mono font-medium">{d.deviceId}</Td>
                    <Td>
                      <StatusPill status={d.status} qcType={d.qcType} verdict={d.verdict} />
                    </Td>
                    <Td>
                      <VerdictPill verdict={d.verdict ?? "PENDING"} />
                    </Td>
                    <Td className="text-xs">
                      {d.qcType ?? <span className="text-muted-foreground">—</span>}
                    </Td>
                    <Td className="text-xs">{d.inspectorId ?? <span className="text-muted-foreground">—</span>}</Td>
                    <Td>
                      <TimeCell
                        value={d.startTime}
                        onChange={(v) => updateRow(d.deviceId, { startTime: v })}
                      />
                    </Td>
                    <Td>
                      <TimeCell
                        value={d.endTime}
                        onChange={(v) => {
                          if (v && d.startTime && v < d.startTime) return;
                          updateRow(d.deviceId, { endTime: v });
                        }}
                      />
                    </Td>
                    <Td>
                      {dur > 0 ? (
                        <span
                          className={cn(
                            "rounded-md px-1.5 py-0.5 font-mono text-xs tabular-nums",
                            bucket === "fast" && "bg-success/15 text-success",
                            bucket === "avg" && "bg-warning/15 text-warning",
                            bucket === "slow" && "bg-destructive/15 text-destructive"
                          )}
                        >
                          {fmtDuration(dur)}
                          {d.status === "In Progress" && " ●"}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </Td>
                    <Td>
                      <EditableText
                        value={d.remarks ?? ""}
                        placeholder="Add remark…"
                        onChange={(v) => updateRow(d.deviceId, { remarks: v })}
                      />
                    </Td>
                    <Td className="text-xs">
                      {d.rejectionReason ? (
                        <span className="text-destructive">{d.rejectionReason}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </Td>
                    <Td>
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm(`Delete ${d.deviceId}?`)) deleteDevice(d.deviceId);
                        }}
                        className="inline-flex items-center gap-1 rounded-md border border-destructive/30 px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="h-3 w-3" />
                        Delete
                      </button>
                    </Td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-sm text-muted-foreground">
                    No devices match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <QRScanner open={scannerOpen} onClose={() => setScannerOpen(false)} onResult={onScan} />
      <BulkConfirm
        open={confirm !== null}
        mode={confirm ?? "approve"}
        count={selected.size}
        onCancel={() => setConfirm(null)}
        onConfirm={handleConfirm(confirm ?? "approve")}
      />
    </div>
  );
}

function durationOf(d: DeviceRow, now: number) {
  if (!d.startTime) return 0;
  const end = d.endTime ?? (d.status === "In Progress" ? now : 0);
  if (!end) return 0;
  return Math.max(0, end - d.startTime);
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={cn("label-mono whitespace-nowrap px-3 py-2", className)}>{children}</th>
  );
}
function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={cn("whitespace-nowrap px-3 py-2 align-middle", className)}>{children}</td>;
}

function StatusPill({ status, qcType, verdict }: { status: DeviceStatus; qcType?: string; verdict?: DeviceRow["verdict"] }) {
  const map: Record<DeviceStatus, string> = {
    Pending: "bg-muted text-muted-foreground",
    "In Progress": "bg-warning/15 text-warning",
    Approved: "bg-success/15 text-success",
    Rejected: "bg-destructive/15 text-destructive",
  };
  const label =
    status === "Pending"
      ? "Queued"
      : qcType === "Pre"
        ? "Pre Approved"
        : qcType === "Post" && status === "Approved"
          ? "Post Approved"
          : qcType === "Post" && status === "Rejected"
            ? "Post Fail"
            : status === "Approved"
              ? "QC Approved"
              : status === "Rejected"
                ? verdict === "FAIL" && qcType === "Pre" ? "Pre Approved" : "Fail"
                : status;
  return (
    <span className={cn("rounded-md px-2 py-0.5 text-[11px] font-semibold", map[status])}>
      {label}
    </span>
  );
}

function VerdictPill({ verdict }: { verdict: "PASS" | "FAIL" | "PENDING" }) {
  const map: Record<typeof verdict, string> = {
    PASS: "bg-success/15 text-success",
    FAIL: "bg-destructive/15 text-destructive",
    PENDING: "bg-muted text-muted-foreground",
  };
  return <span className={cn("rounded-md px-2 py-0.5 text-[11px] font-semibold", map[verdict])}>{verdict}</span>;
}

function EditableText({
  value,
  placeholder,
  onChange,
}: {
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <input
      value={v}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onChange(v)}
      className="w-40 rounded-sm bg-transparent px-1 py-0.5 text-xs focus:bg-background focus:outline-none focus:ring-1 focus:ring-ring"
    />
  );
}

function TimeCell({
  value,
  onChange,
}: {
  value?: number;
  onChange: (v: number | undefined) => void;
}) {
  const toLocal = (ms?: number) => {
    if (!ms) return "";
    const d = new Date(ms);
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  return (
    <input
      type="datetime-local"
      value={toLocal(value)}
      onChange={(e) => {
        const v = e.target.value ? new Date(e.target.value).getTime() : undefined;
        onChange(v);
      }}
      className="rounded-sm bg-transparent px-1 py-0.5 font-mono text-[11px] text-muted-foreground focus:bg-background focus:text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
    />
  );
}
