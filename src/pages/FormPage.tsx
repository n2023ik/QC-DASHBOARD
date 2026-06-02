import React, { useEffect, useMemo, useState } from 'react';
import {
  ShieldCheck,
  Smartphone,
  User,
  Calendar,
  Clock,
  Bluetooth,
  MapPin,
  Lock,
  Unlock,
  Key,
  Battery,
  CheckCircle2,
  ClipboardList,
  XCircle,
  Package,
  AlertTriangle,
  Activity,
  FileText,
  Zap,
  Scissors,
  ShieldAlert,
  Monitor,
  Plus,
  ScanLine,
  type LucideIcon,
} from 'lucide-react';
import { useQC, type DeviceStatus, formatStatusLabel } from '@/lib/qc-store';
import { SHEET_ENV_CONFIG, getSheetWriteUrl, toSheetRowPayload } from '@/lib/google-sheet-sync';
import { QRScanner } from '@/components/qc/QRScanner';

type TabKey = 'pre' | 'post';
type CheckValue = boolean | null;
type CommonField = 'deviceId' | 'inspectorName' | 'version' | 'date' | 'time';

type InspectionTabState = { checks: Record<string, CheckValue>; remarks: string; rejectionReason: string };
type FormState = { common: Record<CommonField, string>; pre: InspectionTabState; post: InspectionTabState };

const CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) || '';
const API_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ||
  SHEET_ENV_CONFIG.appScriptUrl;
const VERSION_OPTIONS = ['3XP', '5XP', 'PHYSICAL'] as const;

function decodeJwt(token: string) {
  try {
    const payload = token.split('.')[1];
    const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(decodeURIComponent(escape(decoded)));
  } catch (e) {
    return {} as any;
  }
}

export default function FormPage() {
  const refreshFromSheet = useQC((s) => s.refreshFromSheet);
  const devices = useQC((s) => s.devices);
  const [activeTab, setActiveTab] = useState<TabKey>('pre');
  const [manualInspector, setManualInspector] = useState('');
  const [queueInput, setQueueInput] = useState('');
  const [selectedQueueIds, setSelectedQueueIds] = useState<string[]>([]);
  const [formData, setFormData] = useState<FormState>({
    common: {
      deviceId: '',
      inspectorName: '',
      version: '',
      date: new Date().toISOString().split('T')[0],
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
    },
    pre: { checks: { bluetooth: null, gps: null, lock: null, unlock: null, passcode: null, battery: null, shackleCondition: null, shackleBand: null, shackleCut: null, glassBroken: null, tampered: null }, remarks: '', rejectionReason: '' },
    post: { checks: { bluetooth: null, gps: null, lock: null, unlock: null, passcode: null, battery: null, finalPackaging: null }, remarks: '', rejectionReason: '' },
  });

  const [user, setUser] = useState<{ name?: string; email?: string; picture?: string } | null>(null);
  const [idToken, setIdToken] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [submitState, setSubmitState] = useState<'idle' | 'saving' | 'submitted' | 'error'>('idle');
  const [submitMessage, setSubmitMessage] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const inspectorName = user?.name || user?.email || manualInspector.trim();
  const allowDevGoogleSignIn = import.meta.env.VITE_ENABLE_DEV_GSI !== 'false';

  useEffect(() => {
    if (inspectorName) useQC.getState().setUser(inspectorName);
  }, [inspectorName]);

  useEffect(() => {
    // Prefill from query param deviceId
    try {
      const params = new URLSearchParams(window.location.search);
      const did = params.get('deviceId');
      const itype = params.get('inspectionType');
      if (did) setFormData((p) => ({ ...p, common: { ...p.common, deviceId: String(did) } }));
      if (itype && (itype.toLowerCase() === 'pre' || itype.toLowerCase() === 'post')) setActiveTab(itype.toLowerCase() as TabKey);
    } catch (e) {}

    // pick up SSO token stored by dashboard
    try {
      const stored = localStorage.getItem('qc-auth-user-token');
      if (stored) {
        setIdToken(stored);
        const payload = decodeJwt(stored);
        setUser({ name: payload.name, email: payload.email, picture: payload.picture });
        setFormData((p) => ({ ...p, common: { ...p.common, inspectorName: payload.name || payload.email || p.common.inspectorName } }));
      }
    } catch (e) {}

    // load GSI script to allow sign-in here too if needed
    if (import.meta.env.DEV && !allowDevGoogleSignIn) {
      setAuthError('Google Sign-In is disabled in local development by configuration.');
      return;
    }

    const scriptId = 'gsi-client';
    if (!document.getElementById(scriptId)) {
      const s = document.createElement('script');
      s.id = scriptId;
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.defer = true;
      s.onload = () => {
        // @ts-ignore
        if (window.google?.accounts?.id) {
          try {
            // @ts-ignore
            window.google.accounts.id.initialize({
              client_id: CLIENT_ID,
              callback: (resp: any) => {
                if (resp?.credential) {
                  const token = resp.credential as string;
                  setIdToken(token);
                  localStorage.setItem('qc-auth-user-token', token);
                  const payload = decodeJwt(token);
                  setUser({ name: payload.name, email: payload.email, picture: payload.picture });
                  setFormData((p) => ({ ...p, common: { ...p.common, inspectorName: payload.name || payload.email || p.common.inspectorName } }));
                }
              },
            });

            // @ts-ignore
            window.google.accounts.id.renderButton(document.getElementById('googleSignInButton'), { theme: 'outline', size: 'large' });
          } catch (error) {
            setAuthError(error instanceof Error ? error.message : 'Google Sign-In is unavailable for this origin');
          }
        }
      };
      s.onerror = () => setAuthError('Failed to load Google Sign-In script');
      document.head.appendChild(s);
    }
  }, [allowDevGoogleSignIn]);

  const currentTabState = formData[activeTab];

  const progress = useMemo(() => {
    const checks = currentTabState.checks;
    const total = Object.keys(checks).length;
    const completed = Object.values(checks).filter((v) => v !== null).length;
    return Math.round((completed / total) * 100);
  }, [currentTabState]);

  const isRejected = useMemo(
    () => activeTab === 'post' && Object.values(currentTabState.checks).some((v) => v === false),
    [activeTab, currentTabState]
  );
  const checkValues = Object.values(currentTabState.checks);
  const completedChecks = checkValues.filter((v) => v !== null).length;
  const failedChecks = checkValues.filter((v) => v === false).length;
  const pendingChecks = checkValues.filter((v) => v === null).length;
  const sheetColumnCount = activeTab === 'pre' ? 21 : 17;
  const readyItems = [
    { label: 'Device ID', done: Boolean(formData.common.deviceId.trim()) },
    { label: 'Inspector', done: Boolean(inspectorName) },
    { label: 'Version', done: Boolean(formData.common.version) },
    { label: 'Checks complete', done: progress === 100 },
    { label: 'Failure reason', done: !isRejected || currentTabState.rejectionReason.trim().length >= 3 },
  ];
  const queueDevices = useMemo(
    () =>
      devices
        .filter((device) => device.queuedByForm && device.verdict === 'PENDING')
        .sort((a, b) => (b.actionAt ?? b.startTime ?? 0) - (a.actionAt ?? a.startTime ?? 0)),
    [devices]
  );
  const selectedQueueDevices = queueDevices.filter((device) => selectedQueueIds.includes(device.deviceId));

  const buildDetailFields = () => {
    const checkEntries = Object.entries(currentTabState.checks).map(([field, value]) => [`${activeTab}_${field}`, value === null ? '' : value ? 'PASS' : 'FAIL']);
    return {
      submittedAt: new Date().toISOString(),
      inspectionType: activeTab.toUpperCase(),
      deviceId: formData.common.deviceId.trim(),
      inspectorName,
      version: formData.common.version,
      date: formData.common.date,
      time: formData.common.time,
      remarks: currentTabState.remarks,
      rejectionReason: currentTabState.rejectionReason,
      progress: `${progress}%`,
      result: activeTab === 'pre' ? 'PASS' : isRejected ? 'FAIL' : progress === 100 ? 'PASS' : 'PENDING',
      ...Object.fromEntries(checkEntries),
    } as Record<string, unknown>;
  };

  const buildSheetPayload = () => {
    const deviceId = formData.common.deviceId.trim();
    const now = Date.now();
    const finalStatus: DeviceStatus = activeTab === 'pre' ? 'Approved' : isRejected ? 'Rejected' : progress === 100 ? 'Approved' : 'Pending';
    const canonical = toSheetRowPayload({
      deviceId,
      status: finalStatus,
      verdict: activeTab === 'pre' ? 'PASS' : finalStatus === 'Approved' ? 'PASS' : finalStatus === 'Rejected' ? 'FAIL' : 'PENDING',
      qcType: activeTab === 'pre' ? 'Pre' : 'Post',
      inspectorId: inspectorName,
      remarks: currentTabState.remarks,
      rejectionReason: currentTabState.rejectionReason || undefined,
      actionBy: inspectorName,
      actionAt: now,
      startTime: now - 30000,
      endTime: now,
    });

    return {
      action: 'update',
      row: {
        ...canonical,
        Version: formData.common.version,
        ...buildDetailFields(),
      },
    };
  };

  const handleSubmit = async () => {
    if (!API_URL) {
      setSubmitState('error');
      setSubmitMessage('API not configured');
      return;
    }
    if (!inspectorName) {
      setSubmitState('error');
      setSubmitMessage('Enter an inspector name or sign in first');
      return;
    }
    if (!formData.common.deviceId.trim()) {
      setSubmitState('error');
      setSubmitMessage('Enter a Device ID before submitting');
      return;
    }
    if (!formData.common.version) {
      setSubmitState('error');
      setSubmitMessage('Select a device version before submitting');
      return;
    }
    if (activeTab === 'post' && isRejected && currentTabState.rejectionReason.trim().length < 3) {
      setSubmitState('error');
      setSubmitMessage('Enter a rejection reason for failed inspections');
      return;
    }
    setSubmitState('saving');
    try {
      const base = getSheetWriteUrl(API_URL).replace(/\/$/, '');
      const isLocalProxy = base.startsWith('/');
      const url = idToken
        ? `${base}${base.includes('?') ? '&' : '?'}token=${encodeURIComponent(idToken)}`
        : import.meta.env.DEV
          ? `${base}${base.includes('?') ? '&' : '?'}dev=1`
          : base;

      const response = await fetch(url, {
        method: 'POST',
        mode: isLocalProxy ? 'same-origin' : 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(buildSheetPayload()),
      });
      if (isLocalProxy && !response.ok) {
        throw new Error(`Sheet write failed (${response.status})`);
      }

      // Push the same row into the local UI state immediately so the dashboard reflects it now.
      const store = useQC.getState();
      const deviceId = formData.common.deviceId.trim();
      const finalStatus: DeviceStatus = activeTab === 'pre' ? 'Approved' : isRejected ? 'Rejected' : progress === 100 ? 'Approved' : 'Pending';
      store.upsertDevice(deviceId);
      store.updateRow(deviceId, {
        status: finalStatus,
        verdict: activeTab === 'pre' ? 'PASS' : finalStatus === 'Approved' ? 'PASS' : finalStatus === 'Rejected' ? 'FAIL' : 'PENDING',
        qcType: activeTab === 'pre' ? 'Pre' : 'Post',
        inspectorId: inspectorName,
        remarks: currentTabState.remarks,
        rejectionReason: currentTabState.rejectionReason || undefined,
        actionBy: inspectorName,
        actionAt: Date.now(),
        startTime: Date.now() - 30000,
        endTime: Date.now(),
        version: formData.common.version,
      });

      // Pull fresh sheet data into the shared UI state immediately.
      // This makes the dashboard reflect the new entry without waiting for the 30s poll.
      setTimeout(() => {
        void refreshFromSheet();
      }, 800);

      setSubmitState('submitted');
      setSubmitMessage('Submitted to Google Sheets.');
    } catch (err) {
      setSubmitState('error');
      setSubmitMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const handleCheck = (field: string, value: CheckValue) => {
    if (!inspectorName) {
      setSubmitMessage('Enter an inspector name or sign in first');
      return;
    }
    // compute next checks to derive immediate status for the table
    const nextChecks = { ...currentTabState.checks, [field]: value };
    const checkValues = Object.values(nextChecks);
    const nextProgress = Math.round((checkValues.filter((v) => v !== null).length / Object.keys(nextChecks).length) * 100);
    const nextIsRejected = activeTab === 'post' && checkValues.some((v) => v === false);
    const finalStatus: DeviceStatus = activeTab === 'pre' ? 'Approved' : nextIsRejected ? 'Rejected' : nextProgress === 100 ? 'Approved' : 'Pending';

    setFormData((p) => ({ ...p, [activeTab]: { ...p[activeTab], checks: { ...p[activeTab].checks, [field]: value } } }));

    // reflect immediately in store/table for the current device
    const deviceId = formData.common.deviceId.trim();
    if (deviceId) {
      const store = useQC.getState();
      store.upsertDevice(deviceId);
      store.updateRow(deviceId, {
        status: finalStatus,
        verdict: activeTab === 'pre' ? 'PASS' : finalStatus === 'Approved' ? 'PASS' : finalStatus === 'Rejected' ? 'FAIL' : 'PENDING',
        qcType: activeTab === 'pre' ? 'Pre' : 'Post',
        inspectorId: inspectorName || undefined,
        actionBy: inspectorName || undefined,
        actionAt: Date.now(),
        queuedByForm: true,
        version: formData.common.version || undefined,
      });
    }
  };

  const markAllPass = () => {
    if (!inspectorName) {
      setSubmitMessage('Enter an inspector name or sign in first');
      return;
    }
    setFormData((p) => ({
      ...p,
      [activeTab]: {
        ...p[activeTab],
        checks: Object.fromEntries(Object.keys(p[activeTab].checks).map((key) => [key, true])),
        rejectionReason: '',
      },
    }));
    // mark device as Approved in store immediately
    const deviceId = formData.common.deviceId.trim();
    if (deviceId) {
      const store = useQC.getState();
      store.upsertDevice(deviceId);
      store.updateRow(deviceId, {
        status: 'Approved',
        verdict: 'PASS',
        qcType: activeTab === 'pre' ? 'Pre' : 'Post',
        inspectorId: inspectorName || undefined,
        actionBy: inspectorName || undefined,
        actionAt: Date.now(),
        queuedByForm: true,
        version: formData.common.version || undefined,
      });
    }
  };

  const resetCurrentTab = () => {
    setFormData((p) => ({
      ...p,
      [activeTab]: {
        checks: Object.fromEntries(Object.keys(p[activeTab].checks).map((key) => [key, null])),
        remarks: '',
        rejectionReason: '',
      },
    }));
    setSubmitState('idle');
    setSubmitMessage('');
  };

  const addDeviceToQueue = (idValue = queueInput) => {
    const id = idValue.trim();
    if (!id) return;
    const store = useQC.getState();
    store.upsertDevice(id);
    store.updateRow(id, {
      status: 'Pending',
      verdict: 'PENDING',
      qcType: 'Pre',
      inspectorId: inspectorName || undefined,
      actionBy: inspectorName || undefined,
      actionAt: Date.now(),
      queuedByForm: true,
      version: formData.common.version || undefined,
    });
    setQueueInput('');
    setSelectedQueueIds((ids) => (ids.includes(id) ? ids : [id, ...ids]));
    setFormData((p) => ({ ...p, common: { ...p.common, deviceId: id } }));
    setTimeout(() => void refreshFromSheet(), 800);
  };

  const toggleQueueSelection = (id: string) => {
    setSelectedQueueIds((ids) => (ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]));
  };

  const approveQueueIds = (ids: string[]) => {
    if (ids.length === 0) return;
    const store = useQC.getState();
    store.approve(ids);
    setSelectedQueueIds((current) => current.filter((id) => !ids.includes(id)));
    setTimeout(() => void refreshFromSheet(), 800);
  };

  const CheckItem = ({ field, label, icon: Icon }: { field: string; label?: string; icon: LucideIcon }) => {
    const value = currentTabState.checks[field];
    return (
      <div className={`group flex items-center justify-between p-4 rounded-2xl border-2 transition-all duration-300 ${value === true ? 'bg-emerald-50 border-emerald-500 shadow-sm' : value === false ? 'bg-rose-50 border-rose-500 shadow-sm' : 'bg-white border-slate-100 hover:border-blue-200'}`}>
        <div className="flex items-center gap-4">
          <div className={`p-3 rounded-xl transition-all ${value === true ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-200' : value === false ? 'bg-rose-500 text-white shadow-lg shadow-rose-200' : 'bg-slate-50 text-slate-400 group-hover:text-blue-500 group-hover:bg-blue-50'}`}>
            <Icon size={20} />
          </div>
          <span className={`font-bold tracking-tight text-sm md:text-base ${value !== null ? 'text-slate-800' : 'text-slate-500'}`}>{label || field.charAt(0).toUpperCase() + field.slice(1)}</span>
        </div>
        <div className="flex gap-1.5 bg-slate-100 p-1 rounded-xl">
          <button onClick={() => handleCheck(field, true)} className={`px-5 py-2 rounded-lg text-[10px] font-black tracking-widest transition-all ${value === true ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`} disabled={!inspectorName}>PASS</button>
          <button onClick={() => handleCheck(field, false)} className={`px-5 py-2 rounded-lg text-[10px] font-black tracking-widest transition-all ${value === false ? 'bg-white text-rose-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`} disabled={!inspectorName}>FAIL</button>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#FDFDFD] text-slate-900 font-sans p-4 md:p-10">
      <div className="max-w-5xl mx-auto">
        <header className="flex flex-col md:flex-row justify-between items-center mb-12 gap-6">
          <div className="flex items-center gap-4">
            <div className="bg-slate-900 p-3 rounded-2xl shadow-xl shadow-slate-200"><ShieldCheck className="text-white" size={32} /></div>
            <div>
              <h1 className="text-2xl font-black tracking-tighter text-slate-900 uppercase">Verification Hub</h1>
              <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" /><p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">QC Inspection Terminal</p></div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex bg-slate-100 p-1.5 rounded-2xl border border-slate-200 shadow-inner">
              {(['pre','post'] as TabKey[]).map((tab) => (
                <button key={tab} onClick={() => setActiveTab(tab)} className={`px-10 py-3 rounded-xl text-xs font-black tracking-widest transition-all ${activeTab===tab ? 'bg-white text-slate-900 shadow-lg' : 'text-slate-400 hover:text-slate-600'}`}>{tab.toUpperCase()} QC</button>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <div id="googleSignInButton" />
              <div className="flex flex-col gap-2">
                <input
                  value={manualInspector}
                  onChange={(e) => setManualInspector(e.target.value)}
                  placeholder="Inspector name"
                  className="w-44 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                />
                {user ? <div className="flex items-center gap-3">{user.picture && <img src={user.picture} alt="avatar" className="w-8 h-8 rounded-full" />}<div className="text-sm font-bold"><div>{user.name||user.email}</div></div></div> : null}
              </div>
            </div>
          </div>
        </header>

        {authError && (
          <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-800">
            {authError}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
          <div className="lg:col-span-7 space-y-8">
            <section className="bg-white rounded-3xl p-6 border border-slate-100 shadow-sm grid grid-cols-2 md:grid-cols-4 gap-4">
              {[{label:'Device ID',icon:Smartphone,field:'deviceId'},{label:'Inspector',icon:User,field:'inspectorName'},{label:'Version',icon:Package,field:'version'},{label:'Date',icon:Calendar,field:'date'},{label:'Time',icon:Clock,field:'time'}].map(item=> (
                <div key={(item as any).field} className="space-y-1">
                  <p className="text-[9px] font-black text-slate-400 uppercase flex items-center gap-1"><item.icon size={10} /> {(item as any).label}</p>
                  { (item as any).field==='deviceId' ? (
                    <div className="flex items-end gap-2">
                      <input className="min-w-0 flex-1 bg-transparent border-b border-slate-100 py-1 text-sm font-bold focus:outline-none focus:border-blue-500 transition-all" value={formData.common.deviceId} onChange={(e)=>setFormData(p=>({...p, common:{...p.common, deviceId: e.target.value.trim()}}))} />
                      <button type="button" onClick={() => setScannerOpen(true)} className="mb-1 inline-flex h-8 w-8 items-center justify-center rounded-xl border border-blue-100 bg-blue-50 text-blue-600 transition hover:bg-blue-100" title="Scan barcode or QR code">
                        <ScanLine size={16} />
                      </button>
                    </div>
                  ) : (item as any).field==='version' ? (
                    <select className="w-full bg-transparent border-b border-slate-100 py-1 text-sm font-bold focus:outline-none focus:border-blue-500 transition-all" value={formData.common.version} onChange={(e)=>setFormData(p=>({...p, common:{...p.common, version:e.target.value}}))}><option value="" disabled>Select version</option>{VERSION_OPTIONS.map(o=> <option key={o} value={o}>{o}</option>)}</select>
                  ) : (item as any).field==='inspectorName' ? (
                    <div className="w-full py-2 text-sm font-bold text-slate-800">{inspectorName || <span className="text-slate-400">Enter inspector name</span>}</div>
                  ) : (
                    <input className="w-full bg-transparent border-b border-slate-100 py-1 text-sm font-bold focus:outline-none focus:border-blue-500 transition-all" value={(formData.common as any)[(item as any).field]} onChange={(e)=>setFormData(p=>({...p, common:{...p.common, [(item as any).field]: e.target.value}}))} />
                  )}
                </div>
              ))}
            </section>

            <section className="space-y-4"> 
              <div className="flex items-center justify-between px-2"><h2 className="text-sm font-black text-slate-400 uppercase tracking-widest flex items-center gap-2"><Activity size={14} /> Check Matrix</h2><span className="text-xs font-black text-blue-600 bg-blue-50 px-3 py-1 rounded-full border border-blue-100">{progress}% COMPLETE</span></div>
              <div className="grid grid-cols-1 gap-3">
                <CheckItem field="bluetooth" icon={Bluetooth} />
                <CheckItem field="gps" label="GPS Connectivity" icon={MapPin} />
                <CheckItem field="lock" icon={Lock} />
                <CheckItem field="unlock" icon={Unlock} />
                <CheckItem field="passcode" label="Security Key" icon={Key} />
                <CheckItem field="battery" label="Battery Integrity" icon={Battery} />
                {activeTab==='pre' ? (<><CheckItem field="shackleCondition" label="Mechanical Shackle" icon={Zap} /><CheckItem field="shackleBand" label="Shackle Band" icon={Activity} /><CheckItem field="shackleCut" label="Shackle Cut" icon={Scissors} /><CheckItem field="glassBroken" label="Glass Broken" icon={Monitor} /><CheckItem field="tampered" label="Tampered" icon={ShieldAlert} /></>) : (<CheckItem field="finalPackaging" label="Packaging QC" icon={Package} />)}
              </div>
            </section>
          </div>
          <div className="lg:col-span-5">
            <div className="sticky top-10 space-y-6">
              <div className="bg-white rounded-3xl p-8 border border-slate-100 shadow-sm space-y-6">
                <div className="flex items-center gap-2 mb-2"><FileText size={18} className="text-slate-400" /><h3 className="font-black text-slate-800 text-sm uppercase tracking-wider">Inspector Comments</h3></div>
                <textarea rows={4} placeholder="Notes on unit condition..." className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-5 py-4 text-sm font-semibold focus:bg-white focus:ring-4 focus:ring-blue-500/10 focus:outline-none transition-all" value={formData[activeTab].remarks} onChange={(e)=>setFormData(p=>({...p, [activeTab]:{...p[activeTab], remarks: e.target.value}}))} />
                {isRejected && (<div className="animate-in slide-in-from-top-2 duration-300"><label className="text-[10px] font-black text-rose-500 uppercase tracking-[0.2em] mb-2 block ml-1 flex items-center gap-2"><AlertTriangle size={12} /> Failure Report Required</label><textarea rows={2} placeholder="Why did this unit fail?" className="w-full bg-rose-50 border-2 border-rose-100 rounded-2xl px-5 py-4 text-sm font-bold text-rose-900 placeholder-rose-200 focus:outline-none" value={formData[activeTab].rejectionReason} onChange={(e)=>setFormData(p=>({...p, [activeTab]:{...p[activeTab], rejectionReason: e.target.value}}))} /></div>)}
              </div>
              <div className={`rounded-[2.5rem] p-10 transition-all duration-700 relative overflow-hidden shadow-2xl ${isRejected ? 'bg-rose-600' : progress===100 ? 'bg-emerald-600' : 'bg-slate-900'}`}><div className="absolute -top-20 -right-20 w-60 h-60 bg-white/10 rounded-full blur-[80px]" />
                <div className="relative z-10 text-center space-y-8">
                  <div className="flex justify-center">{isRejected ? <XCircle size={64} className="text-white" /> : progress===100 ? <CheckCircle2 size={64} className="text-white" /> : <div className="w-16 h-16 rounded-full border-4 border-white/10 border-t-white animate-spin" />}</div>
                  <div><h2 className="text-3xl font-black text-white tracking-tighter leading-none mb-2 uppercase">{isRejected ? 'FAIL' : progress===100 ? 'PASS' : 'Pending'}</h2><p className="text-white/60 text-[10px] font-bold tracking-[0.3em] uppercase">{isRejected ? 'Unit Rejected' : progress===100 ? 'Unit Validated' : 'Inspection Incomplete'}</p></div>
                  <button disabled={progress<100 || !inspectorName} className={`w-full py-5 rounded-2xl font-black text-xs tracking-[0.2em] transition-all transform active:scale-95 ${(progress<100||!inspectorName) ? 'bg-white/10 text-white/30 cursor-not-allowed border border-white/10' : 'bg-white text-slate-900 shadow-xl hover:-translate-y-1'}`} onClick={handleSubmit}>{!inspectorName ? 'ENTER INSPECTOR TO SUBMIT' : submitState==='saving' ? 'SAVING REPORT...' : submitState==='submitted' ? 'SUBMITTED ✓' : 'SUBMIT INSPECTION'}</button>
                  {submitMessage && <p className={`text-[11px] font-bold tracking-wide ${submitState==='error' ? 'text-rose-200' : 'text-white/70'}`}>{submitMessage}</p>}
                </div>
              </div>

              <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
                <div className="grid grid-cols-3 divide-x divide-slate-100 border-b border-slate-100">
                  <div className="p-4 text-center">
                    <div className="text-2xl font-black text-slate-900">{completedChecks}</div>
                    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Done</div>
                  </div>
                  <div className="p-4 text-center">
                    <div className={`text-2xl font-black ${failedChecks ? 'text-rose-600' : 'text-emerald-600'}`}>{failedChecks}</div>
                    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Fails</div>
                  </div>
                  <div className="p-4 text-center">
                    <div className="text-2xl font-black text-blue-600">{sheetColumnCount}</div>
                    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Sheet cols</div>
                  </div>
                </div>
                <div className="p-5 space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-black uppercase tracking-[0.16em] text-slate-800">QC Operation Control</h3>
                      <p className="mt-1 text-xs font-semibold text-slate-400">{pendingChecks} checks pending before sheet submit</p>
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={markAllPass} className="rounded-xl bg-emerald-50 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-emerald-700 border border-emerald-100">All pass</button>
                      <button type="button" onClick={resetCurrentTab} className="rounded-xl bg-slate-50 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500 border border-slate-100">Reset</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-2">
                    {readyItems.map((item) => (
                      <div key={item.label} className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3">
                        <span className="text-xs font-bold text-slate-600">{item.label}</span>
                        <span className={`text-[10px] font-black uppercase tracking-widest ${item.done ? 'text-emerald-600' : 'text-amber-600'}`}>{item.done ? 'Ready' : 'Needed'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <section className="mt-10 rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-blue-600">
                <ClipboardList size={14} /> QC Queue
              </div>
              <h2 className="mt-1 text-xl font-black tracking-tight text-slate-900">Device approval queue</h2>
              <p className="mt-1 text-sm font-semibold text-slate-400">Add device IDs, select one for inspection, or approve selected queue items together.</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={queueInput}
                onChange={(e) => setQueueInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addDeviceToQueue();
                }}
                placeholder="Enter / scan Device ID"
                className="h-11 min-w-[220px] rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-bold focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-500/10"
              />
              <button
                type="button"
                onClick={() => addDeviceToQueue()}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 text-xs font-black uppercase tracking-widest text-white shadow-sm hover:bg-slate-800"
              >
                <Plus size={15} /> Add queue
              </button>
              <button
                type="button"
                onClick={() => approveQueueIds(selectedQueueIds)}
                disabled={selectedQueueIds.length === 0}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 text-xs font-black uppercase tracking-widest text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-40"
              >
                <CheckCircle2 size={15} /> Approve selected
              </button>
              <button
                type="button"
                onClick={() => {
                  const ids = selectedQueueIds;
                  if (ids.length === 0) return;
                  const store = useQC.getState();
                  ids.forEach((id) => store.updateRow(id, { queuedByForm: false }));
                  setSelectedQueueIds((current) => current.filter((id) => !ids.includes(id)));
                  setTimeout(() => void refreshFromSheet(), 800);
                }}
                disabled={selectedQueueIds.length === 0}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 text-xs font-black uppercase tracking-widest text-amber-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Clear selected
              </button>
              <button
                type="button"
                onClick={() => approveQueueIds(queueDevices.map((device) => device.deviceId))}
                disabled={queueDevices.length === 0}
                className="inline-flex h-11 items-center justify-center rounded-2xl border border-emerald-200 bg-emerald-50 px-4 text-xs font-black uppercase tracking-widest text-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Approve all
              </button>
              <button
                type="button"
                onClick={() => {
                  const ids = queueDevices.map((d) => d.deviceId);
                  if (ids.length === 0) return;
                  const store = useQC.getState();
                  ids.forEach((id) => store.updateRow(id, { queuedByForm: false }));
                  setSelectedQueueIds([]);
                  setTimeout(() => void refreshFromSheet(), 800);
                }}
                disabled={queueDevices.length === 0}
                className="inline-flex h-11 items-center justify-center rounded-2xl border border-amber-200 bg-amber-50 px-4 text-xs font-black uppercase tracking-widest text-amber-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Clear all
              </button>
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl bg-slate-50 p-4">
              <div className="text-2xl font-black text-slate-900">{queueDevices.length}</div>
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Open queue</div>
            </div>
            <div className="rounded-2xl bg-blue-50 p-4">
              <div className="text-2xl font-black text-blue-600">{selectedQueueIds.length}</div>
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-blue-400">Selected</div>
            </div>
            <div className="rounded-2xl bg-emerald-50 p-4">
              <div className="text-2xl font-black text-emerald-600">{selectedQueueDevices.filter((device) => device.verdict === 'PENDING').length}</div>
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-500">Ready to approve</div>
            </div>
          </div>

          <div className="mt-5 overflow-hidden rounded-2xl border border-slate-100">
            {queueDevices.length > 0 ? (
              <div className="divide-y divide-slate-100">
                {queueDevices.map((device) => (
                  <div key={device.deviceId} className="flex flex-col gap-3 bg-white px-4 py-3 sm:flex-row sm:items-center">
                    <label className="flex flex-1 items-center gap-3">
                      <input
                        type="checkbox"
                        checked={selectedQueueIds.includes(device.deviceId)}
                        onChange={() => toggleQueueSelection(device.deviceId)}
                        className="h-4 w-4 rounded border-slate-300 text-blue-600"
                      />
                      <span className="font-mono text-sm font-black text-slate-900">{device.deviceId}</span>
                      <span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-widest ${device.status === 'In Progress' ? 'bg-blue-50 text-blue-600' : 'bg-amber-50 text-amber-600'}`}>
                        {formatStatusLabel(device.status, device.qcType)}
                      </span>
                    </label>
                    <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-400">
                      <span>{device.qcType || activeTab.toUpperCase()}</span>
                      <span>{device.inspectorId || 'Unassigned'}</span>
                      <span>{device.version || 'No version'}</span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setFormData((p) => ({ ...p, common: { ...p.common, deviceId: device.deviceId, version: device.version || p.common.version } }));
                          if (device.qcType?.toLowerCase().startsWith('post')) setActiveTab('post');
                          if (device.qcType?.toLowerCase().startsWith('pre')) setActiveTab('pre');
                        }}
                        className="rounded-xl border border-slate-200 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-600 hover:bg-slate-50"
                      >
                        Inspect
                      </button>
                      <button
                        type="button"
                        onClick={() => approveQueueIds([device.deviceId])}
                        className="rounded-xl bg-emerald-600 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const store = useQC.getState();
                          store.updateRow(device.deviceId, { queuedByForm: false });
                          setSelectedQueueIds((curr) => curr.filter((id) => id !== device.deviceId));
                          setTimeout(() => void refreshFromSheet(), 800);
                        }}
                        className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-amber-700"
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-slate-50 px-4 py-8 text-center text-sm font-semibold text-slate-400">No open queue items. Add a Device ID to start.</div>
            )}
          </div>
        </section>
      </div>
      <QRScanner
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onResult={(text) => {
          setFormData((p) => ({ ...p, common: { ...p.common, deviceId: text.trim() } }));
          setScannerOpen(false);
        }}
      />
    </div>
  );
}
