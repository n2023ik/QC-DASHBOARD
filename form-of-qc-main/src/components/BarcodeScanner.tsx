import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';

export default function BarcodeScanner({ open, onClose, onResult }: { open: boolean; onClose: () => void; onResult: (text: string) => void; }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    const start = async () => {
      try {
        const el = ref.current;
        if (!el) return;

        // Ensure element is properly sized and ready
        await new Promise(resolve => setTimeout(resolve, 100));

        // Create scanner with proper configuration
        const scanner = new Html5Qrcode('form-scanner', {
          formatsToSupport: [
            Html5QrcodeSupportedFormats.QR_CODE,
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.UPC_A
          ],
          verbose: false
        });
        scannerRef.current = scanner;

        // Request camera permissions explicitly
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        stream.getTracks().forEach(track => track.stop());

        // Now start scanning
        await scanner.start(
          { facingMode: 'environment' },
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
        console.error('Barcode Scanner error:', e);
        setError(e instanceof Error ? e.message : 'Camera unavailable');
      }
    };

    const stop = async () => {
      try {
        if (scannerRef.current?.isScanning) await scannerRef.current.stop();
        scannerRef.current?.clear();
      } catch {
        // ignore
      }
      scannerRef.current = null;
      onClose();
    };

    start();
    return () => {
      cancelled = true;
      stop();
    };
  }, [open, onClose, onResult]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
      <div className="w-full max-w-md bg-white rounded-lg p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="font-semibold">Scan barcode or QR</div>
          <button onClick={() => onClose()} className="text-sm text-slate-500">Close</button>
        </div>
        <div id="form-scanner" ref={ref} className="w-full aspect-square bg-black rounded-md" style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }} />
        {error && <div className="mt-2 text-xs text-red-600">{error}</div>}
        <div className="mt-3 text-xs text-slate-500">Tip: allow camera access and point close to the barcode.</div>
      </div>
    </div>
  );
}


