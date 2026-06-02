import { useEffect, useRef, useState } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { Camera, X } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  onResult: (text: string) => void;
}

export function QRScanner({ open, onClose, onResult }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);

    const start = async () => {
      try {
        const el = ref.current;
        if (!el) return;

        // Ensure element is properly sized and ready
        await new Promise(resolve => setTimeout(resolve, 100));

        // Create scanner instance
        const scanner = new Html5Qrcode("qc-qr-reader", {
          formatsToSupport: [
            Html5QrcodeSupportedFormats.QR_CODE,
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.UPC_A,
          ],
        });
        scannerRef.current = scanner;

        // Request camera permissions explicitly
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        stream.getTracks().forEach(track => track.stop());

        // Now start scanning
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 240, height: 240 } },
          (decoded) => {
            if (cancelled) return;
            onResult(decoded.trim());
            stop();
          },
          () => {}
        );
      } catch (e: unknown) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : "Camera unavailable";
        console.error("QR Scanner error:", e);
        setError(msg);
      }
    };

    const stop = async () => {
      try {
        if (scannerRef.current?.isScanning) await scannerRef.current.stop();
        scannerRef.current?.clear();
      } catch {
        // ignore teardown errors
      }
      scannerRef.current = null;
    };

    start();
    return () => {
      cancelled = true;
      stop();
    };
  }, [open, onResult]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
      <div className="surface w-full max-w-md p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Camera className="h-4 w-4" />
            <h3 className="font-semibold">Scan device QR</h3>
          </div>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div
          id="qc-qr-reader"
          ref={ref}
          className="mt-4 aspect-square w-full rounded-lg border border-border bg-black"
          style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}
        />

        {error && (
          <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
            {error}. Use manual entry below.
          </div>
        )}

        <div className="mt-4">
          <div className="label-mono mb-1">Or enter Device ID manually</div>
          <div className="flex gap-2">
            <input
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              placeholder="XLR-8800-A"
              className="flex-1 rounded-md border border-input bg-background px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <button
              onClick={() => {
                if (manual.trim()) {
                  onResult(manual.trim());
                  setManual("");
                }
              }}
              className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Use
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
