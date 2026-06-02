import { useState, useEffect } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Clock, AlertCircle } from "lucide-react";
import { Input } from "@/components/ui/input";

interface ApprovalTimerDialogProps {
  open: boolean;
  onApprove: (timestamp?: string) => void;
  onCancel: () => void;
  timerDuration?: number; // seconds
}

export function ApprovalTimerDialog({
  open,
  onApprove,
  onCancel,
  timerDuration = 5,
}: ApprovalTimerDialogProps) {
  const [timeLeft, setTimeLeft] = useState(timerDuration);
  const [timeInput, setTimeInput] = useState("");

  useEffect(() => {
    if (!open) {
      setTimeLeft(timerDuration);
      setTimeInput("");
      return;
    }

    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [open, timerDuration]);

  const isReady = timeLeft === 0;
  const isValidTime = timeInput === "" || /^\d{1,2}:\d{2}$/.test(timeInput);

  const handleApprove = () => {
    onApprove(timeInput || undefined);
  };

  return (
    <AlertDialog open={open} onOpenChange={(newOpen) => !newOpen && onCancel()}>
      <AlertDialogContent>
        <AlertDialogTitle className="flex items-center gap-2">
          <Clock className="h-5 w-5" />
          Approve QC
        </AlertDialogTitle>
        <AlertDialogDescription>
          Please review the inspection details before approving.
        </AlertDialogDescription>

        <div className="flex flex-col items-center gap-4 py-6 space-y-4">
          {/* Timer Section */}
          <div className="text-center w-full">
            <div className="text-6xl font-bold tabular-nums">
              {timeLeft}
            </div>
            <div className="text-sm text-muted-foreground">
              seconds remaining
            </div>
          </div>

          {/* Time Input Section */}
          <div className="w-full space-y-2 border-t pt-4">
            <label className="text-sm font-medium">Approval Time (Optional)</label>
            <Input
              type="time"
              value={timeInput}
              onChange={(e) => setTimeInput(e.target.value)}
              placeholder="HH:MM"
              disabled={!isReady}
              className="disabled:opacity-50"
            />
            <div className="text-xs text-muted-foreground">
              Leave empty for current time, or enter HH:MM (e.g., 14:30)
            </div>
          </div>

          {/* Status Message */}
          {!isReady && (
            <div className="text-center text-sm text-yellow-600 bg-yellow-50 border border-yellow-200 rounded p-3 w-full">
              <AlertCircle className="h-4 w-4 inline mr-2" />
              Please wait for the timer to complete before approving
            </div>
          )}

          {isReady && (
            <div className="text-center text-sm text-green-600 bg-green-50 border border-green-200 rounded p-3 w-full">
              ✓ Ready to approve
            </div>
          )}
        </div>

        <div className="flex gap-3 justify-end">
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleApprove}
            disabled={!isReady || !isValidTime}
            className="disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Approve
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
