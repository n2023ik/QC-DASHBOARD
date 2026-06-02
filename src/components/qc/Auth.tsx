import { useState, useEffect } from "react";
import { LogOut, ShieldCheck } from "lucide-react";
import { useQC } from "@/lib/qc-store";

const STORAGE_KEY = "qc-auth-user";

export function useAuth() {
  const [userId, setUserId] = useState<string | null>(() =>
    typeof window === "undefined" ? null : localStorage.getItem(STORAGE_KEY)
  );
  const [idToken, setIdToken] = useState<string | null>(() =>
    typeof window === "undefined" ? null : localStorage.getItem(`${STORAGE_KEY}-token`)
  );
  const setUser = useQC.getState().setUser;
  useEffect(() => {
    if (userId) setUser(userId);
  }, [setUser, userId]);

  const login = (id: string) => {
    localStorage.setItem(STORAGE_KEY, id);
    setUser(id);
    setUserId(id);
  };
  const loginWithToken = (id: string, token: string) => {
    localStorage.setItem(STORAGE_KEY, id);
    localStorage.setItem(`${STORAGE_KEY}-token`, token);
    setUser(id);
    setUserId(id);
    setIdToken(token);
  };
  const logout = () => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(`${STORAGE_KEY}-token`);
    setUserId(null);
  };
  return { userId, login, loginWithToken, logout, idToken };
}

function decodeJwt(token: string) {
  try {
    const payload = token.split('.')[1];
    const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(decodeURIComponent(escape(decoded)));
  } catch (e) {
    return {} as any;
  }
}

export function LoginScreen({ onLogin }: { onLogin: (id: string) => void }) {
  const devices = useQC((s) => s.devices);
  const [customId, setCustomId] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const auth = useAuth();
  const allowDevGoogleSignIn = import.meta.env.VITE_ENABLE_DEV_GSI !== 'false';

  useEffect(() => {
    if (import.meta.env.DEV && !allowDevGoogleSignIn) {
      setAuthError('Google Sign-In is disabled in local development by configuration.');
      return;
    }

    const scriptId = 'google-identity-main';
    if (document.getElementById(scriptId)) return;
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
            client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
            callback: (resp: any) => {
              if (resp?.credential) {
                const token = resp.credential as string;
                const payload = decodeJwt(token);
                const email = payload.email || payload.sub || 'inspector';
                try {
                  auth.loginWithToken(email, token);
                } catch (e) {
                  localStorage.setItem('qc-auth-user', email);
                  localStorage.setItem('qc-auth-user-token', token);
                }
                onLogin(email);
              }
            },
          });

          // @ts-ignore
          window.google.accounts.id.renderButton(document.getElementById('googleSignInButtonMain'), { theme: 'outline', size: 'large' });
        } catch (error) {
          setAuthError(error instanceof Error ? error.message : 'Google Sign-In is unavailable for this origin');
        }
      }
    };
    s.onerror = () => setAuthError('Failed to load Google Sign-In script');
    document.head.appendChild(s);
  }, [allowDevGoogleSignIn]);
  
  // Extract unique inspectors from sheet data
  const inspectorsFromSheet = Array.from(
    new Map(
      Array.from(new Set(devices.map((d) => d.inspectorId).filter(Boolean)))
        .map((id) => [
          id,
          {
            id,
            name: id.charAt(0).toUpperCase() + id.slice(1),
            role: "Inspector",
          },
        ])
    ).values()
  );

  const inspectors = inspectorsFromSheet.length > 0 ? inspectorsFromSheet : [];

  return (
    <div className="mx-auto flex min-h-[80vh] max-w-3xl flex-col items-center justify-center px-6 py-12">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
        <ShieldCheck className="h-5 w-5" />
      </div>
      <div className="label-mono mt-4">Sign in to QC Systems</div>
      <h2 className="mt-1 text-2xl font-semibold tracking-tight">Pick your inspector profile</h2>
      <p className="mt-2 max-w-md text-center text-sm text-muted-foreground">
        Your actions are tagged with this identity in the audit log.
      </p>
      {authError && (
        <div className="mt-4 max-w-lg rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-800">
          {authError}
        </div>
      )}
      <div className="mt-6 flex items-center gap-4">
        <div id="googleSignInButtonMain" />
      </div>
      <div className="mt-8 w-full max-w-sm rounded-lg border border-border bg-card p-6">
        <div className="text-sm font-medium text-muted-foreground mb-4">
          Enter Inspector ID to continue
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="e.g. john, alice, inspector1"
            value={customId}
            onChange={(e) => setCustomId(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && customId.trim()) {
                onLogin(customId.trim());
              }
            }}
            className="flex-1 px-3 py-2 border border-border rounded-md bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <button
            onClick={() => {
              if (customId.trim()) {
                onLogin(customId.trim());
              }
            }}
            disabled={!customId.trim()}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
          >
            Login
          </button>
        </div>
      </div>

      {inspectors.length > 0 && (
        <div className="mt-8 grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
          {inspectors.map((insp) => (
            <button
              key={insp.id}
              onClick={() => onLogin(insp.id)}
              className="surface group flex flex-col items-center px-6 py-5 transition hover:border-info hover:shadow-md"
            >
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary text-primary-foreground text-base font-medium ring-4 ring-info/20 transition group-hover:ring-info/40">
                {insp.name.split(" ").map((s) => s[0]).join("")}
              </div>
              <div className="mt-3 font-semibold">{insp.name}</div>
              <div className="label-mono">{insp.id}</div>
              <div className="mt-1 text-xs text-info">{insp.role}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function UserBadge({ userId, onLogout }: { userId: string; onLogout: () => void }) {
  const devices = useQC((s) => s.devices);
  
  // Get inspector name from sheet data
  const inspectorName = userId.charAt(0).toUpperCase() + userId.slice(1);
  const inspectorExists = devices.some((d) => d.inspectorId === userId);

  if (!inspectorExists && devices.length > 0) return null;

  return (
    <div className="flex items-center gap-2">
      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] font-medium">
        {inspectorName.split(" ").map((s) => s[0]).join("")}
      </div>
      <div className="hidden text-right leading-tight sm:block">
        <div className="text-xs font-medium">{inspectorName}</div>
        <div className="label-mono">{userId}</div>
      </div>
      <button
        onClick={onLogout}
        title="Sign out"
        className="rounded-md border border-border p-1.5 hover:bg-muted"
      >
        <LogOut className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
