import { useState, useMemo, useEffect } from "react";
import { Clock, Plus, Trash2, CheckCircle2, AlertCircle } from "lucide-react";
import { getLiveInspectorOptions, useQC } from "@/lib/qc-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export interface BatchItem {
  id: string;
  deviceId: string;
  inspectorId: string;
  timestamp?: string; // HH:MM format
  remarks?: string;
}

interface BatchApprovalManagerProps {
  onApprove: (items: BatchItem[]) => void;
  isLoading?: boolean;
}

export function BatchApprovalManager({ onApprove, isLoading }: BatchApprovalManagerProps) {
  const devices = useQC((s) => s.devices);
  const [items, setItems] = useState<BatchItem[]>([]);
  const [deviceIdInput, setDeviceIdInput] = useState("");
  const inspectorOptions = useMemo(() => getLiveInspectorOptions(devices), [devices]);
  const [selectedInspectorId, setSelectedInspectorId] = useState(inspectorOptions[0]?.id || "");
  const [timeInput, setTimeInput] = useState("");
  const [remarksInput, setRemarksInput] = useState("");
  const [open, setOpen] = useState(false);

  // Auto-complete inspector name
  const currentInspector = useMemo(
    () => inspectorOptions.find((i) => i.id === selectedInspectorId),
    [selectedInspectorId, inspectorOptions]
  );

  useEffect(() => {
    if (!selectedInspectorId && inspectorOptions[0]?.id) {
      setSelectedInspectorId(inspectorOptions[0].id);
    }
  }, [inspectorOptions, selectedInspectorId]);

  const addItem = () => {
    if (!deviceIdInput.trim()) return;

    const newItem: BatchItem = {
      id: `${deviceIdInput}-${Date.now()}`,
      deviceId: deviceIdInput.toUpperCase(),
      inspectorId: selectedInspectorId,
      timestamp: timeInput,
      remarks: remarksInput,
    };

    setItems([...items, newItem]);
    setDeviceIdInput("");
    setTimeInput("");
    setRemarksInput("");
  };

  const removeItem = (id: string) => {
    setItems(items.filter((item) => item.id !== id));
  };

  const handleApprove = () => {
    if (items.length === 0) return;
    onApprove(items);
    setItems([]);
    setOpen(false);
  };

  const isValidTime = (time: string) => /^\d{1,2}:\d{2}$/.test(time);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <Plus className="h-4 w-4" />
          Batch Approve
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-success" />
            Batch Approval Manager
          </DialogTitle>
          <DialogDescription>
            Add multiple devices with timestamps and assign inspectors for batch approval
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Input Section */}
          <div className="space-y-3 border border-border rounded-lg p-4 bg-muted/50">
            <div>
              <label className="text-sm font-medium">Device ID</label>
              <Input
                placeholder="e.g., BL10234, XLR-8800"
                value={deviceIdInput}
                onChange={(e) => setDeviceIdInput(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === "Enter" && addItem()}
                className="mt-1"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium">Inspector</label>
                <select
                  value={selectedInspectorId}
                  onChange={(e) => setSelectedInspectorId(e.target.value)}
                  className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  {inspectorOptions.map((inspector) => (
                    <option key={inspector.id} value={inspector.id}>
                      {inspector.name} ({inspector.id})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-sm font-medium">Time (HH:MM)</label>
                <Input
                  placeholder="14:30"
                  value={timeInput}
                  onChange={(e) => setTimeInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addItem()}
                  className="mt-1"
                />
              </div>
            </div>

            <div>
              <label className="text-sm font-medium">Remarks (Optional)</label>
              <Input
                placeholder="Add notes..."
                value={remarksInput}
                onChange={(e) => setRemarksInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addItem()}
                className="mt-1"
              />
            </div>

            <Button
              onClick={addItem}
              disabled={!deviceIdInput.trim() || (timeInput && !isValidTime(timeInput))}
              className="w-full"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add to Batch
            </Button>
          </div>

          {/* Current Inspector Info */}
          {currentInspector && (
            <div className="p-3 rounded-lg bg-info/10 border border-info/30 text-sm">
              <div className="font-medium">Current Inspector</div>
              <div className="text-muted-foreground">
                {currentInspector.name} ({currentInspector.id})
              </div>
            </div>
          )}

          {/* Items List */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <div className="text-sm font-semibold">
                Batch Items ({items.length})
              </div>
              {items.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setItems([])}
                  className="text-destructive"
                >
                  Clear All
                </Button>
              )}
            </div>

            {items.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
                No items added yet. Start adding devices above.
              </div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {items.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between p-3 rounded-lg border border-border bg-card hover:bg-muted/50 transition"
                  >
                    <div className="flex-1">
                      <div className="font-mono font-semibold text-sm">{item.deviceId}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {inspectorOptions.find((i) => i.id === item.inspectorId)?.name || item.inspectorId}
                        {item.timestamp && (
                          <>
                            {" "}
                            · <Clock className="h-3 w-3 inline" /> {item.timestamp}
                          </>
                        )}
                      </div>
                      {item.remarks && (
                        <div className="text-xs text-muted-foreground mt-1">
                          "{item.remarks}"
                        </div>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeItem(item.id)}
                      className="text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2 pt-4 border-t">
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              onClick={handleApprove}
              disabled={items.length === 0 || isLoading}
              className="flex-1"
            >
              <CheckCircle2 className="h-4 w-4 mr-2" />
              Approve {items.length} Devices
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
