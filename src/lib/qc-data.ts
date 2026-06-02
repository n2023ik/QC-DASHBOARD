// Mock QC data simulating Google Sheets feed
export type QCType = "Pre" | "Post";
export type Result = "PASS" | "FAIL";

export interface Inspector {
  id: string;
  name: string;
  role: string;
}

export interface TestDef {
  code: string;
  name: string;
  description: string;
  critical: boolean;
}

export const TESTS: TestDef[] = [
  { code: "SHK-01", name: "Shackle Intact", description: "Verify shackle has no fractures, deformation, or wear.", critical: false },
  { code: "BND-02", name: "Band Intact", description: "Strap continuity and seam quality.", critical: false },
  { code: "DMG-03", name: "Device Damage Free", description: "Housing, screen, and external components.", critical: true },
  { code: "GLS-04", name: "Glass Unbroken", description: "Lens and display glass integrity.", critical: false },
  { code: "WEB-05", name: "Web Integrity", description: "Internal wiring harness inspection.", critical: false },
  { code: "BLE-06", name: "Bluetooth Pairing", description: "Successful pairing handshake within 10s.", critical: false },
  { code: "CHG-07", name: "Charging Function", description: "Charge current within nominal range.", critical: false },
  { code: "CUT-08", name: "Shackle Cut Detection", description: "Tamper sensor triggers correctly.", critical: true },
  { code: "BCT-09", name: "Band Cut Detection", description: "Strap tamper circuit verification.", critical: false },
  { code: "MTR-10", name: "Motor Operational", description: "Vibration motor responsive across full range.", critical: true },
];

export const INSPECTORS: Inspector[] = [
  { id: "maann", name: "Maann", role: "Inspector" },
  { id: "amit", name: "Amit", role: "Inspector" },
  { id: "nikhil", name: "Nikhil", role: "Inspector" },
];

export interface Inspection {
  id: string;
  deviceId: string;
  inspectorId: string;
  qcType: QCType;
  slot: number;
  results: Record<string, Result>; // testCode -> result
  durationSec: number;
  timestamp: number;
  remarks?: string;
}

const seed = (n: number) => {
  let x = Math.sin(n) * 10000;
  return x - Math.floor(x);
};

function generateInspections(): Inspection[] {
  const out: Inspection[] = [];
  const now = Date.now();
  let id = 1;

  for (let d = 0; d < 28; d++) {
    const deviceNum = 8800 + d;
    const variant = ["A", "B", "C"][d % 3];
    const deviceId = `XLR-${deviceNum}-${variant}`;
    const slot = (d % 4) + 1;
    const slotPenalty = slot === 3 ? 0.35 : 0.08;

    for (const qcType of ["Pre", "Post"] as QCType[]) {
      // ~60% of devices have both Pre + Post; some only Pre
      if (qcType === "Post" && seed(d * 7 + 3) > 0.7) continue;

      const inspector = INSPECTORS[Math.floor(seed(d * 11 + (qcType === "Pre" ? 1 : 2)) * INSPECTORS.length)];
      const results: Record<string, Result> = {};
      let anyFail = false;
      TESTS.forEach((t, ti) => {
        const r = seed(d * 31 + ti * 3 + (qcType === "Pre" ? 1 : 5));
        const failProb = (t.critical ? 0.06 : 0.04) + slotPenalty * (qcType === "Post" ? 0.5 : 0.3);
        const fail = r < failProb;
        if (fail) anyFail = true;
        results[t.code] = fail ? "FAIL" : "PASS";
      });

      out.push({
        id: `INS-MOQ${id.toString().padStart(4, "0")}`,
        deviceId,
        inspectorId: inspector.id,
        qcType,
        slot,
        results,
        durationSec: 18 + Math.floor(seed(d * 13 + id) * 22),
        timestamp: now - d * 1000 * 60 * 7 - (qcType === "Post" ? 120000 : 0),
        remarks: anyFail ? "Flagged for review" : undefined,
      });
      id++;
    }
  }
  return out.sort((a, b) => b.timestamp - a.timestamp);
}

export const INSPECTIONS: Inspection[] = generateInspections();

export const isReject = (insp: Inspection) => {
  return TESTS.some((t) => t.critical && insp.results[t.code] === "FAIL");
};

export const isPass = (insp: Inspection) => {
  return TESTS.every((t) => insp.results[t.code] === "PASS");
};

export const failedTests = (insp: Inspection) =>
  TESTS.filter((t) => insp.results[t.code] === "FAIL");

export const outcomeOf = (insp: Inspection): "APPROVED" | "REJECTED" | "RETEST" => {
  if (isPass(insp)) return "APPROVED";
  if (isReject(insp)) return "REJECTED";
  return "RETEST";
};

export const compareQC = (pre?: Inspection, post?: Inspection) => {
  if (!pre && !post) return "NONE";
  if (pre && !post) return "PRE_ONLY";
  if (!pre && post) return "POST_ONLY";
  const preOK = isPass(pre!);
  const postOK = isPass(post!);
  if (preOK && postOK) return "STABLE_OK";
  if (!preOK && !postOK) return "STABLE_FAIL";
  if (preOK && !postOK) return "DROP";
  return "RECOVERED";
};

export const inspectorById = (id: string) => INSPECTORS.find((i) => i.id === id)!;
