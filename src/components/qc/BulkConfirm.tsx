import { useState } from "react";
import { AlertOctagon, CheckCircle2, X, XCircle } from "lucide-react";

interface Props {
  open: boolean;
  mode: "approve" | "reject";
  count: number;
  onCancel: () => void;
  onConfirm: (reason?: string) => void;
}

const REASONS = [
  "Cosmetic damage",
  "Failed BLE pairing",
  "Charging fault",
  "Tamper sensor failure",
  "Motor not responding",
  "Other",
];

export function BulkConfirm({ open, mode, count, onCancel, onConfirm }: Props) {
  const [reason, setReason] = useState(REASONS[0]);
  const [other, setOther] = useState("");

  if (!open) return null;
  const isReject = mode === "reject";
  const finalReason = reason === "Other" ? other.trim() : reason;
  const canConfirm = !isReject || finalReason.length >= 3;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
      <div className="surface w-full max-w-md p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isReject ? (
              <XCircle className="h-5 w-5 text-destructive" />
            ) : (
              <CheckCircle2 className="h-5 w-5 text-success" />
            )}
            <h3 className="font-semibold">
              {isReject ? "Reject" : "Approve"} {count} device{count === 1 ? "" : "s"}?
            </h3>
          </div>
          <button onClick={onCancel} className="rounded-md p-1 hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mt-2 text-sm text-muted-foreground">
          This will be logged to the audit trail. You can undo the last bulk action.
        </p>

        {isReject && (
          <div className="mt-4 space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-medium text-destructive">
              <AlertOctagon className="h-3 w-3" /> Rejection reason required
            </div>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              {REASONS.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
            {reason === "Other" && (
              <input
                value={other}
                onChange={(e) => setOther(e.target.value)}
                placeholder="Describe reason (min 3 chars)"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                autoFocus
              />
            )}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted"
          >
            Cancel
          </button>
          <button
            disabled={!canConfirm}
            onClick={() => onConfirm(isReject ? finalReason : undefined)}
            className={`rounded-md px-3 py-2 text-sm font-medium text-primary-foreground ${
              isReject ? "bg-destructive" : "bg-success"
            } disabled:opacity-50`}
          >
            Confirm {isReject ? "Reject" : "Approve"}
          </button>
        </div>
      </div>
    </div>
  );
}
