import { useMemo, useState } from "react";
import {
  AlertOctagon,
  CheckCircle2,
  Layers,
  Plus,
  Trash2,
  Upload,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { TESTS, type QCType } from "@/lib/qc-data";
import { getLiveInspectorOptions, useQC } from "@/lib/qc-store";
import { promptApprovalTimestamp } from "@/lib/approval-timestamp";
import { BatchApprovalManager, type BatchItem } from "./BatchApprovalManager";

type RowVerdict = "PASS" | "FAIL" | null;

interface BatchRow {
  deviceId: string;
  verdict: RowVerdict;
  failedTests: string[]; // codes
  reason: string;
}

const REASONS = [
  "Cosmetic damage",
  "Failed BLE pairing",
  "Charging fault",
  "Tamper sensor failure",
  "Motor not responding",
  "Other",
];

export function BatchQC() {
  const currentUser = useQC((s) => s.currentUser);
  const devices = useQC((s) => s.devices);
  const inspector = getLiveInspectorOptions(devices, [currentUser])[0] ?? { id: currentUser, name: currentUser, role: "Inspector" };

  const [phase, setPhase] = useState<QCType>("Pre");
  const [batch, setBatch] = useState("");
  const [bulkInput, setBulkInput] = useState("");
  const [rows, setRows] = useState<BatchRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState(REASONS[0]);
  const [reasonOther, setReasonOther] = useState("");
  const [submitMsg, setSubmitMsg] = useState<string | null>(null);

  const addIds = () => {
    const ids = bulkInput
      .split(/[\s,;\n]+/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    if (!ids.length) return;
    setRows((prev) => {
      const seen = new Set(prev.map((r) => r.deviceId));
      const merged = [...prev];
      for (const id of ids) {
        if (!seen.has(id)) {
          merged.push({ deviceId: id, verdict: null, failedTests: [], reason: "" });
          seen.add(id);
        }
      }
      return merged;
    });
    setBulkInput("");
  };

  const removeRow = (id: string) =>
    setRows((r) => r.filter((x) => x.deviceId !== id));

  const toggleSel = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const toggleAll = () =>
    setSelected((s) =>
      s.size === rows.length ? new Set() : new Set(rows.map((r) => r.deviceId))
    );

  const targetIds = (): string[] =>
    selected.size > 0 ? Array.from(selected) : rows.map((r) => r.deviceId);

  const setVerdict = (ids: string[], v: RowVerdict, withTests?: string[]) => {
    setRows((prev) =>
      prev.map((r) =>
        ids.includes(r.deviceId)
          ? {
              ...r,
              verdict: v,
              failedTests: v === "FAIL" ? (withTests ?? r.failedTests) : [],
              reason:
                v === "FAIL"
                  ? r.reason || (reason === "Other" ? reasonOther : reason)
                  : "",
            }
          : r
      )
    );
  };

  const toggleTestForSelected = (code: string) => {
    const ids = targetIds();
    setRows((prev) =>
      prev.map((r) => {
        if (!ids.includes(r.deviceId)) return r;
        const has = r.failedTests.includes(code);
        const failedTests = has
          ? r.failedTests.filter((c) => c !== code)
          : [...r.failedTests, code];
        const test = TESTS.find((t) => t.code === code);
        const willAutoReject = !has && test?.critical;
        return {
          ...r,
          failedTests,
          verdict: failedTests.length > 0 || willAutoReject ? "FAIL" : r.verdict,
          reason:
            failedTests.length > 0
              ? r.reason || (reason === "Other" ? reasonOther : reason)
              : r.reason,
        };
      })
    );
  };

  const counts = useMemo(() => {
    const passed = rows.filter((r) => r.verdict === "PASS").length;
    const failed = phase === "Post" ? rows.filter((r) => r.verdict === "FAIL").length : 0;
    return { passed, failed, pending: rows.length - passed - failed };
  }, [rows]);

  const missingTop = !batch.trim() || rows.length === 0;
  const needsReason = rows.some(
    (r) => phase === "Post" && r.verdict === "FAIL" && r.reason.trim().length < 3
  );
  const incomplete = rows.some((r) => r.verdict === null);
  const canSubmit = !missingTop && !incomplete && !needsReason;

  const submit = () => {
    if (!canSubmit) return;
    const store = useQC.getState();
    const approved: string[] = [];
    const rejectedById: Record<string, string> = {};

    for (const r of rows) {
      store.upsertDevice(r.deviceId);
      store.updateRow(r.deviceId, {
        inspectorId: inspector.id,
        startTime: Date.now() - 30000,
        endTime: Date.now(),
        remarks: `${phase}-QC · ${batch}`,
      });
      if (phase === "Pre" || r.verdict === "PASS") approved.push(r.deviceId);
      else if (r.verdict === "FAIL") rejectedById[r.deviceId] = r.reason;
    }
    if (approved.length) {
      const approvedAt = promptApprovalTimestamp("Enter approval timestamp for approved batch rows");
      if (!approvedAt) return;
      store.approve(approved, approvedAt);
    }
    // group rejects per reason for cleaner audit
    const grouped: Record<string, string[]> = {};
    for (const [id, rsn] of Object.entries(rejectedById)) {
      (grouped[rsn] ??= []).push(id);
    }
    for (const [rsn, ids] of Object.entries(grouped)) {
      store.reject(ids, rsn);
    }
    setSubmitMsg(
      `Saved ${rows.length} device${rows.length === 1 ? "" : "s"} · ${approved.length} QC Approved · ${Object.keys(rejectedById).length} Fail`
    );
    setRows([]);
    setSelected(new Set());
  };

  const handleBatchApproval = (items: BatchItem[]) => {
    const store = useQC.getState();
    const approved: string[] = [];

    for (const item of items) {
      store.upsertDevice(item.deviceId);
      store.updateRow(item.deviceId, {
        inspectorId: item.inspectorId,
        startTime: Date.now() - 30000,
        endTime: Date.now(),
        remarks: item.remarks || "Batch approval",
      });
      approved.push(item.deviceId);
    }

    if (approved.length) {
      let approvalTime = Date.now();
      // If first item has a timestamp, use it for all
      if (items[0]?.timestamp) {
        const [hours, minutes] = items[0].timestamp.split(":").map(Number);
        if (!isNaN(hours) && !isNaN(minutes)) {
          const now = new Date();
          now.setHours(hours, minutes, 0, 0);
          approvalTime = now.getTime();
        }
      }
      store.approve(approved, approvalTime);
    }

    setSubmitMsg(
      `Batch QC Approved · ${approved.length} device${approved.length === 1 ? "" : "s"} saved`
    );
  };

  return (
    <div className="mx-auto max-w-5xl space-y-3 px-4 py-6">
      {/* Header */}
      <div className="surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="label-mono inline-flex items-center gap-1">
              <Layers className="h-3 w-3" /> Batch QC entry
            </div>
            <h1 className="mt-1 text-xl font-semibold tracking-tight">
              Multiple devices · one Pre/Post phase
            </h1>
            <div className="mt-1 text-xs text-muted-foreground">
              Inspector {inspector.id} · {inspector.name}
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="QC Type" required>
            <div className="grid grid-cols-2 gap-2">
              {(["Pre", "Post"] as QCType[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPhase(p)}
                  className={cn(
                    "rounded-md border px-3 py-2 text-sm font-medium transition",
                    phase === p
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card text-muted-foreground hover:border-foreground/20"
                  )}
                >
                  {p}-QC
                </button>
              ))}
            </div>
          </Field>
          <Field label="Batch / Lot" required>
            <input
              value={batch}
              onChange={(e) => setBatch(e.target.value)}
              placeholder="LOT-2026-W18-A"
              className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>
        </div>

        <div className="mt-4">
          <Field label="Add Device IDs (paste multiple — comma / space / newline)">
            <div className="flex flex-col gap-2 sm:flex-row">
              <textarea
                value={bulkInput}
                onChange={(e) => setBulkInput(e.target.value)}
                rows={2}
                placeholder="XLR-8800-A, XLR-8801-B&#10;XLR-8802-C"
                className="flex-1 rounded-md border border-input bg-background px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <button
                type="button"
                onClick={addIds}
                className="inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 sm:w-auto"
              >
                <Plus className="h-4 w-4" /> Add to batch
              </button>
            </div>
          </Field>
        </div>
      </div>

      {/* Rows + bulk toolbar */}
      {rows.length > 0 && (
        <>
          <div className="surface flex flex-wrap items-center gap-2 p-3">
            <span className="label-mono">
              {rows.length} devices · {selected.size} selected · ✓{counts.passed} ✕{counts.failed} ⏳
              {counts.pending}
            </span>

            <span className="mx-1 h-4 w-px bg-border" />

            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="rounded-md border border-input bg-background px-2 py-1 text-xs"
              title="Default fail reason"
            >
              {REASONS.map((r) => (
                <option key={r}>Reason: {r}</option>
              ))}
            </select>
            {reason === "Other" && (
              <input
                value={reasonOther}
                onChange={(e) => setReasonOther(e.target.value)}
                placeholder="Custom reason"
                className="rounded-md border border-input bg-background px-2 py-1 text-xs"
              />
            )}

            <div className="ml-auto flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setVerdict(targetIds(), "PASS")}
                className="inline-flex items-center gap-1 rounded-md bg-success px-3 py-1.5 text-xs font-semibold text-success-foreground"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                Pass {selected.size > 0 ? `(${selected.size})` : "all"}
              </button>
              <button
                type="button"
                onClick={() => setVerdict(targetIds(), "FAIL")}
                className="inline-flex items-center gap-1 rounded-md bg-destructive px-3 py-1.5 text-xs font-semibold text-destructive-foreground"
              >
                <XCircle className="h-3.5 w-3.5" />
                Fail {selected.size > 0 ? `(${selected.size})` : "all"}
              </button>
            </div>
          </div>

          {/* Per-test bulk toggles */}
          <div className="surface p-3">
            <div className="label-mono mb-2">
              Mark a specific test as FAIL on{" "}
              {selected.size > 0 ? `${selected.size} selected` : "all rows"}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {TESTS.map((t) => (
                <button
                  key={t.code}
                  type="button"
                  onClick={() => toggleTestForSelected(t.code)}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition",
                    "border-border bg-card text-muted-foreground hover:border-destructive/40 hover:text-destructive",
                    t.critical && "border-destructive/30 text-destructive"
                  )}
                  title={t.description}
                >
                  {t.critical && <AlertOctagon className="h-3 w-3" />}
                  {t.name}
                </button>
              ))}
            </div>
          </div>

          {/* Table */}
          <div className="surface overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/60 text-left">
                  <tr className="border-b border-border">
                    <Th className="w-8">
                      <input
                        type="checkbox"
                        checked={selected.size === rows.length}
                        onChange={toggleAll}
                        className="h-3.5 w-3.5 accent-primary"
                      />
                    </Th>
                    <Th>Device ID</Th>
                    <Th>Verdict</Th>
                    <Th>Failed tests</Th>
                    <Th>Reason</Th>
                    <Th> </Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.deviceId}
                      className={cn(
                        "border-b border-border",
                        r.verdict === "FAIL" && "bg-destructive/5",
                        r.verdict === "PASS" && "bg-success/5"
                      )}
                    >
                      <Td>
                        <input
                          type="checkbox"
                          checked={selected.has(r.deviceId)}
                          onChange={() => toggleSel(r.deviceId)}
                          className="h-3.5 w-3.5 accent-primary"
                        />
                      </Td>
                      <Td className="font-mono font-medium">{r.deviceId}</Td>
                      <Td>
                        <div className="inline-flex overflow-hidden rounded-md border border-border">
                          <button
                            type="button"
                            onClick={() => setVerdict([r.deviceId], "PASS")}
                            className={cn(
                              "px-2 py-1 text-xs font-medium",
                              r.verdict === "PASS"
                                ? "bg-success text-success-foreground"
                                : "bg-card text-muted-foreground hover:text-success"
                            )}
                          >
                            PASS
                          </button>
                          <button
                            type="button"
                            onClick={() => setVerdict([r.deviceId], "FAIL")}
                            className={cn(
                              "border-l border-border px-2 py-1 text-xs font-medium",
                              r.verdict === "FAIL"
                                ? "bg-destructive text-destructive-foreground"
                                : "bg-card text-muted-foreground hover:text-destructive"
                            )}
                          >
                            FAIL
                          </button>
                        </div>
                      </Td>
                      <Td>
                        {r.failedTests.length === 0 ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {r.failedTests.map((c) => (
                              <span
                                key={c}
                                className="rounded-md border border-destructive/30 bg-destructive/10 px-1.5 py-0.5 label-mono text-destructive"
                              >
                                {c}
                              </span>
                            ))}
                          </div>
                        )}
                      </Td>
                      <Td>
                        {r.verdict === "FAIL" ? (
                          <input
                            value={r.reason}
                            onChange={(e) =>
                              setRows((prev) =>
                                prev.map((x) =>
                                  x.deviceId === r.deviceId ? { ...x, reason: e.target.value } : x
                                )
                              )
                            }
                            placeholder="Reason (required)"
                            className="w-44 rounded-sm border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                          />
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </Td>
                      <Td>
                        <button
                          type="button"
                          onClick={() => removeRow(r.deviceId)}
                          className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Footer */}
      <div className="surface flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="text-xs">
          {missingTop && <span className="text-muted-foreground">⚠ Add Batch + at least 1 Device · </span>}
          {!missingTop && incomplete && (
            <span className="text-muted-foreground">⏳ {counts.pending} devices pending verdict · </span>
          )}
          {!missingTop && !incomplete && needsReason && (
            <span className="text-destructive">Fail reason missing on some rows · </span>
          )}
          {canSubmit && <span className="font-medium text-success">Ready to submit</span>}
          {submitMsg && <div className="mt-1 font-medium text-success">{submitMsg}</div>}
        </div>
        <button
          type="button"
          disabled={!canSubmit}
          onClick={submit}
          className={cn(
            "inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition",
            canSubmit
              ? "bg-primary text-primary-foreground hover:opacity-90"
              : "bg-muted text-muted-foreground"
          )}
        >
          <Upload className="h-4 w-4" /> Submit batch
        </button>
      </div>

      {/* Alternative Batch Approval Manager */}
      <div className="surface p-5 border-info/30 bg-info/5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-sm">Quick Batch Approval</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Directly approve multiple devices with timestamps and inspector assignment
            </p>
          </div>
          <BatchApprovalManager onApprove={handleBatchApproval} />
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="label-mono mb-1">
        {label} {required && <span className="text-destructive">*</span>}
      </div>
      {children}
    </div>
  );
}
function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return <th className={cn("label-mono whitespace-nowrap px-3 py-2", className)}>{children}</th>;
}
function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={cn("whitespace-nowrap px-3 py-2 align-middle", className)}>{children}</td>;
}
