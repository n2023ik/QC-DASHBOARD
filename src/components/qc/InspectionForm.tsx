import { useEffect, useMemo, useRef, useState } from "react";
import { TESTS, type QCType, type Result } from "@/lib/qc-data";
import { getLiveInspectorOptions, useQC } from "@/lib/qc-store";
import { ApprovalTimerDialog } from "./ApprovalTimerDialog";
import {
  AlertOctagon,
  Camera,
  CheckCircle2,
  ChevronRight,
  Clock,
  MapPin,
  RotateCcw,
  Save,
  ScanLine,
  ShieldCheck,
  Upload,
  X,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Verdict = "Draft" | "Submitted" | "Approved" | "Rejected";

const MODELS = ["XLR Tracker v3", "XLR Tracker v4", "XLR Mini"];
const SHIFTS = ["A (Morning)", "B (Evening)", "C (Night)"];

export function InspectionForm() {
  // Identity from store (set at login)
  const currentUser = useQC((s) => s.currentUser);
  const devices = useQC((s) => s.devices);
  const inspector = getLiveInspectorOptions(devices, [currentUser])[0] ?? { id: currentUser, name: currentUser, role: "Inspector" };

  // Required top-4
  const [deviceId, setDeviceId] = useState("");
  const [phase, setPhase] = useState<QCType>("Pre");
  const [batch, setBatch] = useState("");

  // Optional metadata
  const [model, setModel] = useState(MODELS[0]);
  const [shift, setShift] = useState(SHIFTS[0]);
  const [remarks, setRemarks] = useState("");
  const [gpsOn, setGpsOn] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);

  // Checklist
  const [results, setResults] = useState<Record<string, Result | null>>(() =>
    Object.fromEntries(TESTS.map((t) => [t.code, null]))
  );

  // Failure handling
  const [failReason, setFailReason] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Lifecycle
  const [verdict, setVerdict] = useState<Verdict>("Draft");
  const [start] = useState(() => Date.now());
  const [now, setNow] = useState(Date.now());
  const [submitMsg, setSubmitMsg] = useState<string | null>(null);
  
  // Approval dialog
  const [approvalDialogOpen, setApprovalDialogOpen] = useState(false);
  const [pendingFinalVerdict, setPendingFinalVerdict] = useState<"Approved" | "Rejected" | null>(null);
  const [approvalTimestamp, setApprovalTimestamp] = useState("");  // Stores user-entered time

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!gpsOn) return;
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setGpsOn(false),
      { enableHighAccuracy: false, timeout: 5000 }
    );
  }, [gpsOn]);

  const elapsed = Math.floor((now - start) / 1000);

  const counts = useMemo(() => {
    const passed = Object.values(results).filter((r) => r === "PASS").length;
    const failed = Object.values(results).filter((r) => r === "FAIL").length;
    const critical = TESTS.filter((t) => t.critical && results[t.code] === "FAIL").length;
    return { passed, failed, critical, done: passed + failed };
  }, [results]);

  const autoReject = counts.critical > 0;
  const anyFail = phase === "Post" && counts.failed > 0;
  const allDone = counts.done === TESTS.length;

  // Required validation
  const missingTop = !deviceId.trim() || !batch.trim();
  const needsReason = anyFail && failReason.trim().length < 3;
  const needsPhoto = anyFail && !photo;
  const canSubmit = !missingTop && allDone && !needsReason && !needsPhoto;

  const reset = () => {
    setResults(Object.fromEntries(TESTS.map((t) => [t.code, null])));
    setFailReason("");
    setPhoto(null);
    setVerdict("Draft");
    setSubmitMsg(null);
  };

  const onPhoto = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setPhoto(reader.result as string);
    reader.readAsDataURL(file);
  };

  const submit = () => {
    if (!canSubmit) return;
    const final: Verdict = phase === "Pre" ? "Approved" : autoReject || anyFail ? "Rejected" : "Approved";
    const id = deviceId.trim();
    const store = useQC.getState();
    store.upsertDevice(id);

    if (final === "Approved") {
      // Open approval timer dialog
      setPendingFinalVerdict("Approved");
      setApprovalDialogOpen(true);
    } else {
      // Reject immediately
      store.updateRow(id, {
        slot: undefined,
        inspectorId: inspector.id,
        startTime: start,
        endTime: Date.now(),
        remarks: remarks || undefined,
      });
      store.reject([id], failReason || "Failed checklist");
      setVerdict(final);
      setSubmitMsg(`${final} · ${id} saved to device list`);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-3 px-4 py-6">
      {/* === TOP CARD: 4 required fields only === */}
      <div className="surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="label-mono">Protocol QC v4.2</div>
            <h1 className="mt-1 text-xl font-semibold tracking-tight">New inspection</h1>
            <div className="mt-1 text-xs text-muted-foreground">
              Inspector {inspector.id} · {inspector.name}
            </div>
          </div>
          <VerdictPill verdict={verdict} />
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Device ID" required>
            <input
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value.toUpperCase())}
              placeholder="XLR-8800-A"
              className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>

          <Field label="Inspector" required>
            <div className="flex h-[38px] items-center gap-2 rounded-md border border-input bg-muted px-3 text-sm">
              <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="font-medium">{inspector.name}</span>
              <span className="label-mono">{inspector.id}</span>
            </div>
          </Field>

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

        {/* Compact secondary row */}
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <span className="label-mono inline-flex items-center gap-1">
            <Clock className="h-3 w-3" /> {elapsed}s
          </span>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="rounded-md border border-input bg-background px-2 py-1 text-xs"
            title="Model"
          >
            {MODELS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
          <select
            value={shift}
            onChange={(e) => setShift(e.target.value)}
            className="rounded-md border border-input bg-background px-2 py-1 text-xs"
            title="Shift"
          >
            {SHIFTS.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setGpsOn((v) => !v)}
            className={cn(
              "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs",
              gpsOn ? "border-info/40 bg-info/10 text-info" : "border-border text-muted-foreground"
            )}
          >
            <MapPin className="h-3 w-3" />
            {coords ? `${coords.lat.toFixed(2)}, ${coords.lng.toFixed(2)}` : "GPS off"}
          </button>
          <button
            type="button"
            onClick={reset}
            className="ml-auto inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
          >
            <RotateCcw className="h-3 w-3" /> Reset
          </button>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
          <MiniStat label="Passed" value={counts.passed} cls="text-success" />
          <MiniStat label="Failed" value={counts.failed} cls="text-destructive" />
          <MiniStat label="Critical" value={counts.critical} cls="text-warning" />
        </div>
      </div>

      {/* === CHECKLIST CARDS === */}
      <div className="surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="label-mono">Checklist · {TESTS.length} items</div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                setResults(Object.fromEntries(TESTS.map((t) => [t.code, "PASS"])) as Record<string, Result>)
              }
              className="inline-flex items-center gap-1 rounded-md border border-success/30 bg-success/10 px-2 py-1 label-mono text-success hover:bg-success/20"
            >
              <CheckCircle2 className="h-3 w-3" /> Approve all
            </button>
            <span className="label-mono inline-flex items-center gap-1 text-destructive">
              <AlertOctagon className="h-3 w-3" /> {TESTS.filter((t) => t.critical).length} critical
            </span>
          </div>
        </div>

        <div className="mt-3 space-y-3">
          {TESTS.map((t, i) => {
            const r = results[t.code];
            return (
              <div
                key={t.code}
                className={cn(
                  "rounded-lg border p-3 transition",
                  r === "PASS" && "border-success/40 bg-success/5",
                  r === "FAIL" && "border-destructive/40 bg-destructive/5",
                  !r && "border-border bg-card"
                )}
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-muted font-mono text-xs tabular-nums">
                    {(i + 1).toString().padStart(2, "0")}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{t.name}</span>
                      <span className="rounded-md border border-border bg-muted px-1.5 label-mono">{t.code}</span>
                      {t.critical && (
                        <span className="inline-flex items-center gap-1 rounded-md border border-destructive/30 bg-destructive/10 px-1.5 label-mono text-destructive">
                          <AlertOctagon className="h-3 w-3" /> Auto-Reject
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">{t.description}</div>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {(["PASS", "FAIL"] as Result[]).map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setResults((p) => ({ ...p, [t.code]: opt }))}
                      className={cn(
                        "flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition",
                        opt === "PASS" &&
                          (r === "PASS"
                            ? "border-success bg-success text-success-foreground"
                            : "border-border bg-card text-muted-foreground hover:border-success/40 hover:text-success"),
                        opt === "FAIL" &&
                          (r === "FAIL"
                            ? "border-destructive bg-destructive text-destructive-foreground"
                            : "border-border bg-card text-muted-foreground hover:border-destructive/40 hover:text-destructive")
                      )}
                    >
                      {opt === "PASS" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                      {opt}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* === FAILURE BLOCK (only when needed) === */}
      {anyFail && (
        <div className="surface border-destructive/30 bg-destructive/5 p-4">
          <div className="flex items-center gap-2">
            <AlertOctagon className="h-4 w-4 text-destructive" />
            <h3 className="font-semibold text-destructive">
              {autoReject ? "Critical failure — auto-reject" : "Failure detected"}
            </h3>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Reason and photo proof are required before submitting.
          </p>

          <div className="mt-3 space-y-3">
            <Field label="Fail reason" required>
              <textarea
                value={failReason}
                onChange={(e) => setFailReason(e.target.value)}
                rows={2}
                placeholder="Describe what failed (min 3 chars)…"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </Field>

            <Field label="Photo proof" required>
              {photo ? (
                <div className="relative inline-block">
                  <img src={photo} alt="Failure proof" className="h-32 rounded-md border border-border object-cover" />
                  <button
                    type="button"
                    onClick={() => setPhoto(null)}
                    className="absolute right-1 top-1 rounded-full bg-background/90 p-1 hover:bg-background"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="inline-flex items-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground hover:bg-muted"
                >
                  <Camera className="h-4 w-4" /> Capture / upload photo
                </button>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => onPhoto(e.target.files?.[0] ?? undefined)}
                className="hidden"
              />
            </Field>

            <button
              type="button"
              onClick={() => {
                setResults(Object.fromEntries(TESTS.map((t) => [t.code, null])));
                setFailReason("");
                setPhoto(null);
              }}
              className="inline-flex items-center gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-3 py-1.5 text-xs font-medium text-warning hover:bg-warning/20"
            >
              <RotateCcw className="h-3 w-3" /> Recheck / Retest
            </button>
          </div>
        </div>
      )}

      {/* === REMARKS (optional) === */}
      <div className="surface p-4">
        <Field label="Remarks (optional)">
          <textarea
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            rows={2}
            placeholder="Any extra notes for the audit log…"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </Field>
      </div>

      {/* === FOOTER / SUBMIT === */}
      <div className="surface flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="space-y-0.5 text-xs">
          <div className="label-mono inline-flex items-center gap-1">
            <ScanLine className="h-3 w-3" /> {phase}-QC · {model} · {shift}
          </div>
          <div className="text-muted-foreground">
            {missingTop && "⚠ Fill Device ID & Batch · "}
            {!allDone && `${TESTS.length - counts.done} checks pending · `}
            {needsReason && "Reason required · "}
            {needsPhoto && "Photo required · "}
            {canSubmit && "Ready to submit"}
          </div>
          {submitMsg && <div className="font-medium text-success">{submitMsg}</div>}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setVerdict("Draft")}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs hover:bg-muted"
          >
            <Save className="h-3.5 w-3.5" /> Save draft
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={submit}
            className={cn(
              "inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition",
              canSubmit
                ? autoReject || anyFail
                  ? "bg-destructive text-destructive-foreground hover:opacity-90"
                  : "bg-success text-success-foreground hover:opacity-90"
                : "bg-muted text-muted-foreground"
            )}
          >
            {autoReject || anyFail ? <XCircle className="h-4 w-4" /> : <Upload className="h-4 w-4" />}
            Submit · {autoReject || anyFail ? "Fail" : "QC Approved"}
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <ApprovalTimerDialog
        open={approvalDialogOpen}
        onApprove={(timestamp) => {
          let approvalTime = Date.now();
          if (timestamp) {
            // Parse HH:MM format and create timestamp for today
            const [hours, minutes] = timestamp.split(":").map(Number);
            if (!isNaN(hours) && !isNaN(minutes)) {
              const now = new Date();
              now.setHours(hours, minutes, 0, 0);
              approvalTime = now.getTime();
            }
          }
          setApprovalTimestamp(timestamp || "");
          
          // Now execute the approval
          const final = "Approved";
          const id = deviceId.trim();
          const store = useQC.getState();
          store.updateRow(id, {
            slot: undefined,
            inspectorId: inspector.id,
            startTime: start,
            endTime: Date.now(),
            remarks: remarks || undefined,
          });
          store.approve([id], approvalTime);
          setVerdict(final);
          setSubmitMsg(`${final === "Approved" ? "QC Approved" : "Fail"} · ${id} saved to device list`);
          setApprovalDialogOpen(false);
          setPendingFinalVerdict(null);
        }}
        onCancel={() => {
          setApprovalDialogOpen(false);
          setPendingFinalVerdict(null);
        }}
        timerDuration={5}
      />
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

function VerdictPill({ verdict }: { verdict: Verdict }) {
  const cls: Record<Verdict, string> = {
    Draft: "bg-muted text-muted-foreground",
    Submitted: "bg-info/15 text-info",
    Approved: "bg-success/15 text-success",
    Rejected: "bg-destructive/15 text-destructive",
  };
  const label = verdict === "Approved" ? "QC Approved" : verdict === "Rejected" ? "Fail" : verdict;
  return (
    <span className={cn("rounded-md px-2.5 py-1 text-xs font-semibold", cls[verdict])}>{label}</span>
  );
}

function MiniStat({ label, value, cls }: { label: string; value: number; cls: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="label-mono">{label}</div>
      <div className={cn("font-mono text-2xl font-semibold tabular-nums", cls)}>
        {value.toString().padStart(2, "0")}
      </div>
    </div>
  );
}
