import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  AlertOctagon,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Clock,
  Download,
  RefreshCw,
  TrendingUp,
  Upload,
  XCircle,
  Trophy,
  ScanLine,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn } from "@/lib/utils";
import { getSheetSourceSummary, getSheetWriteUrl, toSheetRowPayload } from "@/lib/google-sheet-sync";
import { useQC, type DeviceRow, type DeviceStatus, formatStatusLabel } from "@/lib/qc-store";
import { QCFilter, filterDevices, type QCFilterState } from "./QCFilter";
import { formatDateTime, formatDate, formatTime as formatTimeUtil } from "@/lib/date-format";
import { QRScanner } from "@/components/qc/QRScanner";

function FormQuickAccess() {
  const [scanId, setScanId] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const formUrl = (import.meta.env.VITE_FORM_URL as string | undefined) || "/form";
  const sheetUrl = getSheetWriteUrl();
  const refreshFromSheet = useQC((s) => s.refreshFromSheet);

  const getCurrentInspector = () => {
    // prefer stored auth user if present
    const auth = typeof window !== 'undefined' ? (localStorage.getItem('qc-auth-user') || '') : '';
    return auth || '';
  };

  const openForm = (prefill?: string) => {
    const base = formUrl;
    const url = prefill ? `${base}${base.includes('?') ? '&' : '?'}deviceId=${encodeURIComponent(prefill)}` : base;
    window.open(url, "_blank");
  };

  return (
      <div className="flex items-center gap-2">
      <input
        value={scanId}
        onChange={(e) => setScanId(e.target.value)}
        placeholder="Scan / enter ID"
        className="px-2 py-1 rounded-md border border-border text-sm w-40"
        onKeyDown={(e) => { if (e.key === 'Enter' && scanId.trim()) { openForm(scanId.trim()); setScanId(''); } }}
      />
      <button onClick={() => { openForm(scanId.trim()); setScanId(''); }} className="px-3 py-1 rounded-md bg-primary text-primary-foreground text-sm">Form</button>
      <button onClick={() => setScannerOpen(true)} className="inline-flex items-center justify-center px-2 py-1 rounded-md border border-slate-100 bg-white text-sm" title="Scan QR">
        <ScanLine className="h-4 w-4" />
      </button>
      <button
        onClick={async () => {
          const id = scanId.trim();
          if (!id) return;
          if (!sheetUrl) {
            alert('Apps Script URL not configured (VITE_APP_SCRIPT_URL).');
            return;
          }
          const token = typeof window !== 'undefined' ? localStorage.getItem('qc-auth-user-token') : null;
          if (!token && !import.meta.env.DEV) { alert('Sign in first to create rows'); return; }

          const now = new Date();
          const inspector = getCurrentInspector();
          const payload = {
            ...toSheetRowPayload({
              deviceId: id,
              status: 'Pending',
              verdict: 'PENDING',
              qcType: 'Pre',
              inspectorId: inspector,
              actionBy: inspector,
              actionAt: now.getTime(),
            }),
            submittedAt: now.toISOString(),
            inspectionType: 'PRE',
            deviceId: id,
            inspectorName: inspector,
            version: '',
            date: now.toISOString().split('T')[0],
            time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
            remarks: '',
            rejectionReason: '',
            progress: '0%',
            result: 'PENDING',
            pre_bluetooth: '',
            pre_gps: '',
            pre_lock: '',
            pre_unlock: '',
            pre_passcode: '',
            pre_battery: '',
            pre_shackleCondition: '',
            pre_shackleBand: '',
            pre_shackleCut: '',
            pre_glassBroken: '',
            pre_tampered: '',
          };

          try {
            const url = token
              ? `${sheetUrl}${sheetUrl.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`
              : `${sheetUrl}${sheetUrl.includes('?') ? '&' : '?'}dev=1`;
            const isLocalProxy = sheetUrl.startsWith('/');
            const res = await fetch(url, {
              method: 'POST',
              mode: isLocalProxy ? 'same-origin' : 'no-cors',
              headers: { 'Content-Type': 'text/plain;charset=utf-8' },
              body: JSON.stringify({ action: 'create', row: payload }),
            });
            if (isLocalProxy && !res.ok) throw new Error(`HTTP ${res.status}`);

            const store = useQC.getState();
            store.upsertDevice(id);
            store.updateRow(id, {
              status: 'Pending',
              verdict: 'PENDING',
              qcType: 'Pre',
              inspectorId: getCurrentInspector(),
              actionBy: getCurrentInspector(),
              actionAt: Date.now(),
              remarks: '',
              version: '',
            });

            setScanId('');
            // refresh dashboard after the request is queued
            try { await refreshFromSheet(); } catch (e) { /* ignore */ }
            alert('Created row for ' + id);
          } catch (err) {
            alert('Create failed: ' + (err instanceof Error ? err.message : String(err)));
          }
        }}
        className="px-3 py-1 rounded-md bg-emerald-600 text-white text-sm"
      >Create</button>
        <QRScanner open={scannerOpen} onClose={() => setScannerOpen(false)} onResult={(text) => { setScanId(text); setScannerOpen(false); }} />
    </div>
  );
}

const STATUS_COLOR: Record<DeviceStatus, string> = {
  Approved: "text-success",
  Rejected: "text-destructive",
  Pending: "text-warning",
  "In Progress": "text-info",
};

const STATUS_BG: Record<DeviceStatus, string> = {
  Approved: "bg-success/10 text-success border-success/30",
  Rejected: "bg-destructive/10 text-destructive border-destructive/30",
  Pending: "bg-warning/10 text-warning border-warning/30",
  "In Progress": "bg-info/10 text-info border-info/30",
};

const statusLabel = formatStatusLabel;

export function QCDashboard({
  onNewInspection,
  onOpenDevice,
}: {
  onNewInspection: () => void;
  onOpenDevice: (deviceId: string) => void;
}) {
  const liveDevices = useQC((s) => s.devices);
  const sheetSync = useQC((s) => s.sheetSync);
  const highlightDevice = useQC((s) => s.highlight);
  const [now, setNow] = useState(Date.now());
  const [deviceSearch, setDeviceSearch] = useState("");
  const [filterState, setFilterState] = useState<QCFilterState>({
    timeRange: "all",
    versions: [],
  });

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const availableVersions = useMemo(() => {
    const versions = new Set<string>();
    liveDevices.forEach((d) => {
      if (d.version) versions.add(d.version);
    });
    return Array.from(versions).sort();
  }, [liveDevices]);

  const filteredDevices = useMemo(() => {
    const q = deviceSearch.trim().toLowerCase();
    const source = q ? liveDevices.filter((d) => d.deviceId.toLowerCase().includes(q)) : liveDevices;
    return [...filterDevices(source, filterState)].sort((a, b) => tsOf(b) - tsOf(a));
  }, [liveDevices, filterState, deviceSearch]);

  // Summary stats should reflect the live sheet / all live devices (not just filtered view)
  const stats = useMemo(() => {
    const total = liveDevices.length;
    let approved = liveDevices.filter((d) => d.status === "Approved").length;
    let rejected = liveDevices.filter((d) => d.status === "Rejected").length;
    // open should represent devices you explicitly queued and that are still PENDING
    const pending = liveDevices.filter((d) => d.status === "Pending").length;
    const inProgress = liveDevices.filter((d) => d.status === "In Progress").length;
    const open = liveDevices.filter((d) => d.queuedByForm && (d.verdict ?? 'PENDING') === 'PENDING').length;
    const durations = liveDevices.map((d) => durationOf(d, now)).filter((ms) => ms > 0);
    const avg = durations.length ? durations.reduce((sum, ms) => sum + ms, 0) / durations.length : 0;
    const best = durations.length ? Math.min(...durations) : 0;
    // If sheet rows are available, derive counts from the sheet
    let sheetApproved = 0;
    let sheetRejected = 0;
    if (sheetSync.rawRows && sheetSync.rawRows.length > 0) {
      const isPre = (r: Record<string, unknown>) => {
        const type = String((r as any).inspectionType ?? (r as any).qcType ?? (r as any).QCType ?? "").toUpperCase().trim();
        return type.startsWith("PRE");
      };
      sheetApproved = (sheetSync.rawRows as Array<Record<string, unknown>>).filter((r) => {
        const v = String((r as any).Verdict ?? (r as any).verdict ?? (r as any).Result ?? (r as any).result ?? "").toUpperCase().trim();
        return isPre(r) || v.includes("PASS");
      }).length;
      sheetRejected = (sheetSync.rawRows as Array<Record<string, unknown>>).filter((r) => {
        const v = String((r as any).Verdict ?? (r as any).verdict ?? (r as any).Result ?? (r as any).result ?? "").toUpperCase().trim();
        return !isPre(r) && v.includes("FAIL");
      }).length;
    }

    // Count local approvals/rejections that happened after last sheet sync so UI updates immediately
    const lastSync = sheetSync.lastSyncAt ?? 0;
    const localApprovedAfterSync = liveDevices.filter((d) => d.status === "Approved" && (d.actionAt ?? 0) > lastSync).length;
    const localRejectedAfterSync = liveDevices.filter((d) => d.status === "Rejected" && (d.actionAt ?? 0) > lastSync).length;

    // Combine sheet counts with recent local changes
    approved = sheetApproved + localApprovedAfterSync;
    rejected = sheetRejected + localRejectedAfterSync;

    const yieldPct = total ? (approved / total) * 100 : 0;
    return { total, approved, rejected, pending, inProgress, open, avg, best, yieldPct };
  }, [liveDevices, now, sheetSync.rawRows]);

  const verdictCounts = useMemo(() => {
    const counts = { PASS: 0, FAIL: 0, PENDING: 0 };
    filteredDevices.forEach((device) => {
      if (device.status === "Approved" || device.qcType === "Pre") counts.PASS += 1;
      else if (device.status === "Rejected") counts.FAIL += 1;
      else counts.PENDING += 1;
    });
    return counts;
  }, [filteredDevices]);

  const rawSheetRows = sheetSync.rawRowCount ?? liveDevices.length;
  const rawRows = sheetSync.rawRows ?? [];
  const rawHeaders = useMemo(() => {
    const keys = new Set<string>();
    rawRows.forEach((row) => Object.keys(row).forEach((key) => keys.add(key)));
    return Array.from(keys);
  }, [rawRows]);

  const byPhase = useMemo(() => {
    const phase = (t: "Pre" | "Post") => {
      const list = filteredDevices.filter((d) => d.qcType === t);
      const approved = list.filter((d) => d.status === "Approved").length;
      const rejected = list.filter((d) => d.status === "Rejected").length;
      const open = list.filter((d) => d.queuedByForm && (d.verdict ?? 'PENDING') === 'PENDING').length;
      const durations = list.map((d) => durationOf(d, now)).filter((ms) => ms > 0);
      const avgMs = durations.length ? durations.reduce((sum, ms) => sum + ms, 0) / durations.length : 0;
      return { count: list.length, approved, rejected, open, avgMs };
    };

    return { Pre: phase("Pre"), Post: phase("Post") };
  }, [filteredDevices, now]);

  const issueReasons = useMemo(() => {
    const counts = new Map<string, number>();
    const parseReasons = (value: string) =>
      value
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);

    const normalizeReason = (value: string) => {
      const v = value.trim().toLowerCase();
      if (!v) return "Unspecified";
      if (v.includes("lock unlock")) return "Lock unlock issue";
      if (v.includes("shackle band")) return "Shackle band";
      if (v.includes("shackle cut")) return "Shackle cut";
      if (v.includes("tamper")) return "Tampered";
      if (v.includes("not getting open") || v.includes("not opening") || v.includes("won't open") || v.includes("wont open")) return "Not getting open";
      if (v.includes("glass")) return "Glass broken";
      if (v.includes("battery")) return "Battery issue";
      if (v.includes("bluetooth")) return "Bluetooth issue";
      if (v.includes("passcode")) return "Passcode issue";
      return value.replace(/\s+/g, " ").trim();
    };

    liveDevices.forEach((device) => {
      // Include devices that were rejected OR have an explicit rejectionReason/remarks
      // Also include PRE rows that recorded a FAIL (device.verdict === 'FAIL') so their reasons surface
      const isFail = device.status === "Rejected" || device.verdict === "FAIL";
      const raw = (device.rejectionReason || device.remarks || "").trim();
      if (!isFail && !raw) return;
      const rawVal = raw || "Unspecified";
      const reasons = parseReasons(raw);
      if (reasons.length === 0) reasons.push("Unspecified");

      reasons.forEach((reason) => {
        const cleanReason = normalizeReason(reason);
        counts.set(cleanReason, (counts.get(cleanReason) ?? 0) + 1);
      });
    });

    return Array.from(counts.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [liveDevices]);

  const inspectorStats = useMemo(() => {
    const map = new Map<
      string,
      { id: string; name: string; total: number; approved: number; rejected: number; avgMs: number }
    >();

    filteredDevices.forEach((device) => {
      const inspectorId = device.inspectorId || "Unassigned";
      const current = map.get(inspectorId) ?? {
        id: inspectorId,
        name: inspectorId,
        total: 0,
        approved: 0,
        rejected: 0,
        avgMs: 0,
      };

      current.total += 1;
      if (device.status === "Approved") current.approved += 1;
      if (device.status === "Rejected") current.rejected += 1;
      current.avgMs += durationOf(device, now);
      map.set(inspectorId, current);
    });

    return Array.from(map.values())
      .map((item) => ({
        ...item,
        avgMs: item.total ? item.avgMs / item.total : 0,
        yieldPct: item.total ? (item.approved / item.total) * 100 : 0,
      }))
      .sort((a, b) => (a.avgMs || 999) - (b.avgMs || 999));
  }, [filteredDevices, now]);

  const hourly = useMemo(() => {
    const buckets: Record<string, { hour: string; pre: number; post: number; open: number }> = {};
    for (let hour = 0; hour < 24; hour++) {
      const key = `${hour.toString().padStart(2, "0")}h`;
      buckets[key] = { hour: key, pre: 0, post: 0, open: 0 };
    }

    filteredDevices.forEach((device) => {
      const ts = device.actionAt ?? device.endTime ?? device.startTime;
      if (!ts) return;
      const key = `${new Date(ts).getHours().toString().padStart(2, "0")}h`;
      const bucket = buckets[key] ?? { hour: key, pre: 0, post: 0, open: 0 };
      if (device.qcType === "Pre") bucket.pre += 1;
      if (device.qcType === "Post") bucket.post += 1;
      if (device.queuedByForm && (device.verdict ?? 'PENDING') === 'PENDING') bucket.open += 1;
      buckets[key] = bucket;
    });

    return Object.values(buckets);
  }, [filteredDevices]);

  const recent = useMemo(
    () => [...filteredDevices].sort((a, b) => tsOf(b) - tsOf(a)).slice(0, 8),
    [filteredDevices]
  );

  return (
    <div className="mx-auto max-w-[1400px] space-y-6 px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="label-mono">
            Operations Overview · Today · {new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
          </div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">QC Dashboard</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <QCFilter state={filterState} onChange={setFilterState} availableVersions={availableVersions} />
          <div className="relative">
            <input
              value={deviceSearch}
              onChange={(e) => setDeviceSearch(e.target.value)}
              placeholder="Search Device ID"
              className="w-full sm:w-44 rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          {/* Form quick access + scanner - on small screens move below filters */}
          <div className="w-full sm:w-auto sm:order-none order-last">
            <FormQuickAccess />
          </div>
          <button
            onClick={onNewInspection}
            className="group inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition hover:opacity-90"
          >
            New Inspection
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <button
          type="button"
          onClick={() => onOpenDevice("")}
          className="surface p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md"
        >
          <div className="label-mono">Live source</div>
          <div className="mt-1 text-sm font-medium">{getSheetSourceSummary()}</div>
          <div className="mt-1 text-xs text-muted-foreground">Apps Script endpoint driving queue data</div>
        </button>
        <button
          type="button"
          onClick={() => onOpenDevice("")}
          className="surface p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md"
        >
          <div className="label-mono">Live rows</div>
          <div className="mt-1 stat-num text-info">{String(rawSheetRows).padStart(2, "0")}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {filteredDevices.length} matching rows · {liveDevices.length} total live · {stats.approved} QC Approved · {stats.rejected} Fail
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            <span className="rounded-full bg-success/10 px-2 py-1 text-success">QC Approved {verdictCounts.PASS}</span>
            <span className="rounded-full bg-destructive/10 px-2 py-1 text-destructive">Fail {verdictCounts.FAIL}</span>
            <span className="rounded-full bg-muted px-2 py-1 text-muted-foreground">Verdict PENDING {verdictCounts.PENDING}</span>
          </div>
        </button>
        <div className="surface p-4">
          <div className="label-mono">Sync status</div>
          <div className={cn("mt-1 text-sm font-medium", sheetSync.syncing ? "text-warning" : "text-success")}>
            {sheetSync.syncing ? "Syncing now" : "Ready"}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {sheetSync.lastSyncAt ? `Last sync ${new Date(sheetSync.lastSyncAt).toLocaleTimeString()}` : "No sync yet"}
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Total Live" value={rawSheetRows} icon={<Activity className="h-4 w-4" />} note="Rows from Apps Script" onClick={() => onOpenDevice("")} />
        <StatCard label="QC Approved" value={stats.approved} icon={<CheckCircle2 className="h-4 w-4 text-success" />} note={`${stats.yieldPct.toFixed(1)}% yield`} valueClass="text-success" onClick={() => onOpenDevice("")} />
        <StatCard label="Fail" value={stats.rejected} icon={<XCircle className="h-4 w-4 text-destructive" />} note="Manual / auto" valueClass="text-destructive" onClick={() => onOpenDevice("")} />
        <StatCard label="Open Queue" value={stats.open} icon={<RefreshCw className="h-4 w-4 text-warning" />} note="Pending + in progress" valueClass="text-warning" onClick={() => onOpenDevice("")} />
        <StatCard label="Avg Time" value={`${Math.round(stats.avg / 1000)}s`} icon={<Clock className="h-4 w-4 text-info" />} note={`Best ${stats.best ? `${Math.round(stats.best / 1000)}s` : "—"}`} valueClass="text-info" />
      </div>

      <div className="surface p-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold">Top Rejection Reasons</h3>
            <p className="text-xs text-muted-foreground">Most frequent failure reasons (top 5)</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                const now = new Date().toISOString();
                const subject = encodeURIComponent(`QC Top Rejection Reasons ${now}`);
                const lines = issueReasons.map((r) => `- ${r.reason}: ${r.count}`).join('\n');
                const body = encodeURIComponent(`Top Rejection Reasons (as of ${now}):\n\n${lines}\n\nGenerated from QC Dashboard`);
                window.location.href = `mailto:?subject=${subject}&body=${body}`;
              }}
              className="rounded-md border border-border px-3 py-1 text-sm hover:bg-muted"
            >
              Email report
            </button>
          </div>
        </div>

        <div className="mt-4">
          {issueReasons.length === 0 ? (
            <div className="text-sm text-muted-foreground">No rejection reasons recorded.</div>
          ) : (
            <ul className="space-y-2">
              {issueReasons.map((r) => (
                <li key={r.reason} className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                  <div className="text-sm">{r.reason}</div>
                  <div className="text-sm font-bold text-destructive">{r.count}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="surface p-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold">QC Snapshot</h3>
              <p className="text-xs text-muted-foreground">Simple readout for daily operation decisions</p>
            </div>
            <span className={cn("rounded-full px-3 py-1 text-xs font-semibold", stats.rejected > 0 ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success")}>
              {stats.rejected > 0 ? `${stats.rejected} needs review` : "No failures"}
            </span>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <InsightTile label="First-pass yield" value={`${stats.yieldPct.toFixed(0)}%`} tone={stats.yieldPct >= 90 ? "success" : stats.yieldPct >= 75 ? "warning" : "danger"} />
            <InsightTile label="Open queue" value={stats.open} tone={stats.open > 0 ? "warning" : "success"} />
            <InsightTile label="Fail ratio" value={`${stats.total ? ((stats.rejected / stats.total) * 100).toFixed(0) : 0}%`} tone={stats.rejected > 0 ? "danger" : "success"} />
          </div>
        </div>

        <div className="surface p-5">
          <div className="flex items-center gap-2">
            <AlertOctagon className="h-4 w-4 text-destructive" />
            <h3 className="font-semibold">Immediate Attention</h3>
          </div>
          <div className="mt-4 space-y-3">
            {recent
              .filter((device) =>
                device.status === "Rejected" || (device.status === "Pending" && (device.verdict ?? "PENDING") === "PENDING")
              )
              .slice(0, 3)
              .map((device) => (
              <button
                key={device.deviceId}
                type="button"
                onClick={() => {
                  highlightDevice(device.deviceId);
                  onOpenDevice(device.deviceId);
                }}
                className="flex w-full items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2 text-left hover:bg-muted"
              >
                <span className="font-mono text-sm font-semibold">{device.deviceId}</span>
                <span className={cn("rounded-full border px-2 py-0.5 label-mono", STATUS_BG[device.status])}>{statusLabel(device.status, device.qcType)}</span>
              </button>
            ))}
            {recent.every((device) => device.status !== "Rejected" && device.status !== "Pending") && (
              <div className="rounded-lg border border-success/20 bg-success/5 px-3 py-4 text-sm text-success">Queue looks clear.</div>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <PhaseCard title="Pre-QC" subtitle="Incoming inspection" icon={<Download className="h-4 w-4 text-info" />} stats={byPhase.Pre} />
        <PhaseCard title="Post-QC" subtitle="Final / outgoing inspection" icon={<Upload className="h-4 w-4 text-success" />} stats={byPhase.Post} />
        <div className="surface p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-info" />
              <h3 className="font-semibold">Pre vs Post · Live Queue</h3>
            </div>
            <span className="label-mono">now</span>
          </div>
          <div className="mt-4 h-44">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={[
                  { phase: "Pre-QC", Approved: byPhase.Pre.approved, Open: byPhase.Pre.open, Rejected: byPhase.Pre.rejected },
                  { phase: "Post-QC", Approved: byPhase.Post.approved, Open: byPhase.Post.open, Rejected: byPhase.Post.rejected },
                ]}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="phase" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12, border: "1px solid hsl(var(--border))" }} />
                <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="Approved" stackId="a" fill="hsl(var(--success))" radius={[0, 0, 0, 0]} />
                <Bar dataKey="Open" stackId="a" fill="hsl(var(--warning))" />
                <Bar dataKey="Rejected" stackId="a" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="surface p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-info" />
            <h3 className="font-semibold">Hourly Throughput · Live Queue</h3>
          </div>
          <span className="label-mono">today</span>
        </div>
        <div className="mt-4 h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={hourly}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="hour" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12, border: "1px solid hsl(var(--border))" }} />
              <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="pre" stroke="hsl(var(--info))" strokeWidth={2} dot={{ r: 3 }} name="Pre" />
              <Line type="monotone" dataKey="post" stroke="hsl(var(--success))" strokeWidth={2} dot={{ r: 3 }} name="Post" />
              <Line type="monotone" dataKey="open" stroke="hsl(var(--warning))" strokeWidth={2} dot={{ r: 3 }} name="Open" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="surface p-5">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Top Rejection Reasons</h3>
            <span className="label-mono">live</span>
          </div>
          <div className="mt-4 space-y-3">
            {issueReasons.length > 0 ? (
              issueReasons.map((reason) => {
                const max = issueReasons[0]?.count ?? 1;
                return (
                  <div key={reason.reason}>
                    <div className="flex items-center gap-2 text-sm">
                      <AlertOctagon className="h-3.5 w-3.5 text-destructive" />
                      <span className="font-medium">{reason.reason}</span>
                      <span className="ml-auto font-mono tabular-nums">{reason.count}</span>
                    </div>
                    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-destructive" style={{ width: `${(reason.count / max) * 100}%` }} />
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="text-sm text-muted-foreground">No rejected rows yet.</div>
            )}
          </div>
        </div>

        <div className="surface p-5">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Throughput Yield</h3>
            <span className="label-mono inline-flex items-center gap-1 text-success">
              <TrendingUp className="h-3 w-3" /> Live
            </span>
          </div>
          <div className="mt-4 grid grid-cols-3 items-center gap-4">
            <div>
              <div className="stat-num">{stats.yieldPct.toFixed(0)}%</div>
              <div className="label-mono mt-1">First-pass yield</div>
            </div>
            <div className="col-span-2 space-y-3">
              <YieldBar label="QC Approved" value={stats.approved} max={stats.total} color="bg-success" />
              <YieldBar label="Open" value={stats.open} max={stats.total} color="bg-warning" />
              <YieldBar label="Fail" value={stats.rejected} max={stats.total} color="bg-destructive" />
            </div>
          </div>
        </div>
      </div>

      <div className="surface p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-warning" />
            <h3 className="font-semibold">Inspector Comparison</h3>
          </div>
          <span className="label-mono">live queue</span>
        </div>
        <div className="mt-4 divide-y divide-border">
          {inspectorStats.length > 0 ? (
            inspectorStats.map((insp, index) => {
              const maxAvg = Math.max(...inspectorStats.map((x) => x.avgMs || 0), 30_000);
              const isFastest = index === 0 && insp.avgMs > 0;
              const idle = insp.total === 0;
              return (
                <div key={insp.id} className="flex items-center gap-4 py-3">
                  <Avatar name={insp.name} highlighted={isFastest} />
                  <div className="min-w-[160px]">
                    <div className="flex items-center gap-2">
                      <span className={cn("font-medium", idle && "text-muted-foreground")}>{insp.name}</span>
                      {isFastest && <span className="label-mono text-info">fastest</span>}
                    </div>
                    <div className="label-mono">{insp.id}</div>
                  </div>
                  <div className="flex-1">
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn("h-full rounded-full", isFastest ? "bg-info" : "bg-primary/40")}
                        style={{ width: insp.avgMs ? `${(insp.avgMs / maxAvg) * 100}%` : "0%" }}
                      />
                    </div>
                  </div>
                  <div className="w-28 text-right">
                    <div className="font-mono text-lg tabular-nums">{insp.avgMs ? `${Math.round(insp.avgMs / 1000)}s` : "—"}</div>
                    <div className="label-mono">avg / row</div>
                  </div>
                  <div className="w-24 text-right">
                    <div className="font-mono text-sm tabular-nums">
                      <span className="text-success">{insp.approved}P</span>{" "}
                      <span className="text-destructive">{insp.rejected}F</span>{" "}
                      <span className="text-muted-foreground">/ {insp.total}</span>
                    </div>
                    <div className={cn("label-mono", idle ? "text-muted-foreground" : "")}>{idle ? "Idle" : `${insp.yieldPct.toFixed(0)}% yield`}</div>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="py-8 text-center text-sm text-muted-foreground">No live inspector data yet.</div>
          )}
        </div>
      </div>

      <div className="surface p-5">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Recent Live Queue</h3>
          <span className="label-mono">{filteredDevices.length} of {liveDevices.length} total {deviceSearch ? `· ID: ${deviceSearch}` : ''}</span>
        </div>
        <div className="mt-4 divide-y divide-border">
              {filteredDevices.length > 0 ? (
              filteredDevices.slice(0, 8).map((device) => {
              const inspectorLabel = device.inspectorId || "Unassigned";
              return (
                  <button
                    key={device.deviceId}
                    type="button"
                    onClick={() => {
                      highlightDevice(device.deviceId);
                      onOpenDevice(device.deviceId);
                    }}
                    className="flex w-full items-center gap-4 rounded-lg py-3 text-left transition hover:bg-muted/40"
                  >
                    <Avatar name={inspectorLabel} small />
                    <div className={cn("flex h-7 items-center gap-1 rounded-full border px-2.5 label-mono", STATUS_BG[device.status])}>
                      {device.status === "Approved" && <CheckCircle2 className="h-3 w-3" />}
                      {device.status === "Rejected" && <XCircle className="h-3 w-3" />}
                      {device.status === "Pending" && <RefreshCw className="h-3 w-3" />}
                      {device.status === "In Progress" && <Activity className="h-3 w-3" />}
                      {device.status}
                    </div>
                    <div className="min-w-[170px]">
                      <div className="font-mono font-semibold">{device.deviceId}</div>
                      <div className="label-mono">{device.qcType ?? "-"} · Slot {device.slot ?? "-"} · {device.version || "No version"}</div>
                    </div>
                    <div className="flex-1 text-sm">
                      <div className="text-muted-foreground">
                        {inspectorLabel} · <span className={STATUS_COLOR[device.status]}>{device.rejectionReason || device.remarks || "No remarks"}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-sm tabular-nums">{formatTime(tsOf(device))}</div>
                      <div className="label-mono inline-flex items-center gap-1">
                        <Clock className="h-3 w-3" /> {Math.max(0, Math.round(durationOf(device, now) / 1000))}s
                      </div>
                    </div>
                  </button>
              );
            })
          ) : (
            <div className="py-8 text-center text-sm text-muted-foreground">
              {liveDevices.length === 0 ? "No live queue data yet." : "No devices match the selected filters."}
            </div>
          )}
        </div>
      </div>

      <div className="surface p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold">Whole Sheet Data</h3>
            <p className="text-xs text-muted-foreground">Raw sheet rows kept at the bottom for audit and troubleshooting</p>
          </div>
          <div className="text-right">
            <div className="label-mono">{rawRows.length} raw rows</div>
            {sheetSync.lastError && <div className="mt-1 text-xs text-destructive">{sheetSync.lastError}</div>}
          </div>
        </div>

        <div className="mt-4 max-h-[520px] overflow-auto rounded-lg border border-border">
          <table className="w-full min-w-[1100px] text-left text-xs">
            <thead className="sticky top-0 z-10 bg-muted/95 backdrop-blur">
              <tr>
                {rawHeaders.length > 0 ? rawHeaders.map((key) => (
                  <th key={key} className="whitespace-nowrap border-b border-border px-3 py-2 font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    {key}
                  </th>
                )) : (
                  <th className="px-3 py-2 text-muted-foreground">No rows loaded yet</th>
                )}
              </tr>
            </thead>
            <tbody>
              {rawRows.map((row, index) => (
                <tr key={index} className="border-b border-border/60 odd:bg-background even:bg-muted/20">
                  {rawHeaders.map((key) => (
                    <td key={key} className="max-w-[260px] whitespace-nowrap px-3 py-2 font-mono text-[11px] tabular-nums">
                      <span className="block truncate" title={String(row[key] ?? "")}>{formatSheetCell(key, row[key])}</span>
                    </td>
                  ))}
                </tr>
              ))}
              {rawRows.length === 0 && (
                <tr>
                  <td colSpan={Math.max(1, rawHeaders.length)} className="px-3 py-8 text-center text-sm text-muted-foreground">
                    No raw sheet rows available yet. Reload after sync or check the endpoint error above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  note,
  valueClass,
  onClick,
}: {
  label: string;
  value: string | number;
  icon: ReactNode;
  note: string;
  valueClass?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "surface p-4 text-left transition",
        onClick && "cursor-pointer hover:-translate-y-0.5 hover:shadow-md"
      )}
    >
      <div className="flex items-center justify-between">
        <span className="label-mono">{label}</span>
        {icon}
      </div>
      <div className={cn("stat-num mt-2", valueClass)}>{typeof value === "number" ? value.toString().padStart(2, "0") : value}</div>
      <div className="label-mono mt-1 normal-case tracking-normal text-xs">{note}</div>
    </button>
  );
}

function InsightTile({ label, value, tone }: { label: string; value: string | number; tone: "success" | "warning" | "danger" }) {
  const toneClass = {
    success: "border-success/20 bg-success/5 text-success",
    warning: "border-warning/20 bg-warning/5 text-warning",
    danger: "border-destructive/20 bg-destructive/5 text-destructive",
  }[tone];

  return (
    <div className={cn("rounded-lg border p-4", toneClass)}>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="label-mono mt-1">{label}</div>
    </div>
  );
}

function PhaseCard({ title, subtitle, icon, stats }: { title: string; subtitle: string; icon: ReactNode; stats: { count: number; approved: number; rejected: number; open: number; avgMs: number } }) {
  const yieldPct = stats.count ? (stats.approved / stats.count) * 100 : 0;
  return (
    <div className="surface p-5">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary">{icon}</div>
          <div>
            <h3 className="font-semibold">{title}</h3>
            <div className="text-xs text-muted-foreground">{subtitle}</div>
          </div>
        </div>
        <div className="text-right">
          <div className="stat-num text-info">{stats.count.toString().padStart(2, "0")}</div>
          <div className="label-mono">Rows</div>
        </div>
      </div>
      <div className="mt-4 h-1.5 flex w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-success" style={{ width: `${stats.count ? (stats.approved / stats.count) * 100 : 0}%` }} />
        <div className="h-full bg-warning" style={{ width: `${stats.count ? (stats.open / stats.count) * 100 : 0}%` }} />
        <div className="h-full bg-destructive" style={{ width: `${stats.count ? (stats.rejected / stats.count) * 100 : 0}%` }} />
      </div>
      <div className="mt-2 flex justify-between text-xs font-mono tabular-nums">
        <span>
          <span className="text-success">{stats.approved}</span> <span className="label-mono">approved</span>
        </span>
        <span>
          <span className="text-warning">{stats.open}</span> <span className="label-mono">open</span>
        </span>
        <span>
          <span className="text-destructive">{stats.rejected}</span> <span className="label-mono">reject</span>
        </span>
      </div>
      <div className="mt-4 grid grid-cols-2 border-t border-border pt-4">
        <div>
          <div className="label-mono">Yield</div>
          <div className="mt-1 text-info font-mono text-lg tabular-nums">{yieldPct.toFixed(0)}%</div>
        </div>
        <div>
          <div className="label-mono">Avg time</div>
          <div className="mt-1 font-mono text-lg tabular-nums">{stats.count ? `${Math.round(stats.avgMs / 1000)}s` : "—"}</div>
        </div>
      </div>
    </div>
  );
}

function YieldBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="label-mono w-16">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${max ? (value / max) * 100 : 0}%` }} />
      </div>
      <span className="w-8 text-right font-mono text-sm tabular-nums">{value}</span>
    </div>
  );
}

function Avatar({ name, highlighted, small }: { name: string; highlighted?: boolean; small?: boolean }) {
  const initials = name
    .split(" ")
    .map((s) => s[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground font-medium",
        small ? "h-8 w-8 text-xs" : "h-10 w-10 text-sm",
        highlighted && "ring-2 ring-info ring-offset-2 ring-offset-background"
      )}
    >
      {initials || "--"}
    </div>
  );
}

function durationOf(row: DeviceRow, now: number) {
  if (!row.startTime) return 0;
  const end = row.endTime ?? (row.status === "In Progress" ? now : 0);
  if (!end) return 0;
  return Math.max(0, end - row.startTime);
}

function tsOf(row: DeviceRow) {
  return row.actionAt ?? row.endTime ?? row.startTime ?? 0;
}

function formatTime(ts: number) {
  if (!ts) return "—";
  return formatDateTime(ts);
}

function formatSheetCell(key: string, value: unknown) {
  if (value === undefined || value === null || value === "") return "—";
  const normalizedKey = key.trim().toLowerCase();
  const raw = String(value);
  const parsed = Date.parse(raw);

  if (!Number.isNaN(parsed)) {
    if (normalizedKey === "date") return new Date(parsed).toLocaleDateString();
    if (normalizedKey === "time") {
      return new Date(parsed).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
    }
    if (normalizedKey.includes("at") || normalizedKey.includes("time")) return formatDateTime(parsed);
  }

  if (normalizedKey === "progress") {
    const numeric = Number(raw);
    if (Number.isFinite(numeric) && numeric >= 0 && numeric <= 1) return `${Math.round(numeric * 100)}%`;
  }

  return raw;
}
