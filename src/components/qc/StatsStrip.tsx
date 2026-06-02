import { useMemo } from "react";
import { useQC, fmtDuration, type DeviceRow } from "@/lib/qc-store";
import { Activity, CheckCircle2, ListChecks, Timer, XCircle } from "lucide-react";

export function StatsStrip() {
  const devices = useQC((s) => s.devices);
  const rawRowCount = useQC((s) => s.sheetSync.rawRowCount);

  const stats = useMemo(() => {
    const total = rawRowCount ?? devices.length;
    const approved = devices.filter((d) => d.status === "Approved").length;
    const rejected = devices.filter((d) => d.status === "Rejected").length;
    const inProg = devices.filter((d) => d.status === "In Progress").length;
    const finished = devices.filter((d) => d.startTime && d.endTime);
    const avgMs =
      finished.length > 0
        ? finished.reduce((acc, d) => acc + ((d.endTime! - d.startTime!) || 0), 0) / finished.length
        : 0;

    const byUser: Record<string, { total: number; approved: number; rejected: number; durMs: number; n: number }> = {};
    for (const d of devices) {
      if (!d.actionBy) continue;
      const u = (byUser[d.actionBy] ??= { total: 0, approved: 0, rejected: 0, durMs: 0, n: 0 });
      u.total++;
      if (d.status === "Approved") u.approved++;
      if (d.status === "Rejected") u.rejected++;
      if (d.startTime && d.endTime) {
        u.durMs += d.endTime - d.startTime;
        u.n++;
      }
    }

    return { total, approved, rejected, inProg, avgMs, byUser };
  }, [devices, rawRowCount]);

  const inspectors = useMemo(() => {
    const map = new Map<string, { id: string; name: string; total: number; approved: number; rejected: number; durMs: number; n: number }>();

    for (const d of devices) {
      const id = String(d.inspectorId || d.actionBy || "").trim();
      if (!id) continue;
      const current = map.get(id) ?? { id, name: id, total: 0, approved: 0, rejected: 0, durMs: 0, n: 0 };
      current.total += 1;
      if (d.status === "Approved") current.approved += 1;
      if (d.status === "Rejected") current.rejected += 1;
      if (d.startTime && d.endTime) {
        current.durMs += d.endTime - d.startTime;
        current.n += 1;
      }
      map.set(id, current);
    }

    return Array.from(map.values())
      .map((item) => ({ ...item, rate: item.total ? (item.approved / item.total) * 100 : 0, avg: item.n ? item.durMs / item.n : 0 }))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  }, [devices]);

  return (
    <div className="mx-auto max-w-[1400px] space-y-4 px-4 pt-6 sm:px-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Card icon={<ListChecks className="h-4 w-4" />} label="Sheet rows" value={stats.total} />
        <Card icon={<CheckCircle2 className="h-4 w-4 text-success" />} label="QC Approved" value={stats.approved} />
        <Card icon={<XCircle className="h-4 w-4 text-destructive" />} label="Fail" value={stats.rejected} />
        <Card icon={<Activity className="h-4 w-4 text-warning" />} label="In progress" value={stats.inProg} />
        <Card
          icon={<Timer className="h-4 w-4 text-info" />}
          label="Avg QC time"
          value={stats.avgMs ? fmtDuration(stats.avgMs) : "—"}
        />
      </div>

      <div className="surface p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-semibold">Per-inspector performance</h3>
          <span className="label-mono">Approve rate · avg time</span>
        </div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {inspectors.length > 0 ? inspectors.map((insp) => (
            <div key={insp.id} className="rounded-lg border border-border bg-card p-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">{insp.name}</div>
                  <div className="label-mono">{insp.id} · Inspector</div>
                </div>
                <div className="text-right font-mono text-xs tabular-nums">
                  <div className="text-success">{insp.rate.toFixed(0)}% QC Approved</div>
                  <div className="text-muted-foreground">{insp.avg ? fmtDuration(insp.avg) : "—"} avg</div>
                </div>
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-success" style={{ width: `${insp.rate}%` }} />
              </div>
              <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
                <span>{insp.approved} QC Approved</span>
                <span>{insp.rejected} Fail</span>
                <span>{insp.total} actions</span>
              </div>
            </div>
          )) : (
            <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground md:col-span-2">
              No live inspector data yet. Create rows or sync the sheet to populate this section.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Card({ icon, label, value }: { icon: React.ReactNode; label: string; value: number | string }) {
  return (
    <div className="surface p-4">
      <div className="flex items-center gap-2 label-mono">{icon}{label}</div>
      <div className="stat-num mt-1">{value}</div>
    </div>
  );
}

export function recentDevices(devices: DeviceRow[]) {
  return [...devices].sort((a, b) => (b.actionAt ?? 0) - (a.actionAt ?? 0)).slice(0, 5);
}
