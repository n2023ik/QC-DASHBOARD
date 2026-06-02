import { useEffect } from "react";
import { SHEET_REFRESH_MS } from "@/lib/google-sheet-sync";
import { useQC } from "@/lib/qc-store";

export function SheetSyncDaemon() {
  const syncEnabled = useQC((s) => s.sheetSync.enabled);
  const refreshFromSheet = useQC((s) => s.refreshFromSheet);

  useEffect(() => {
    if (!syncEnabled) return;
    void refreshFromSheet();
    const timer = window.setInterval(() => {
      void refreshFromSheet();
    }, SHEET_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [refreshFromSheet, syncEnabled]);

  return null;
}