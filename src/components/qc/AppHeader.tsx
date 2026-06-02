import { ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { UserBadge } from "./Auth";

export type View = "dashboard" | "devices" | "inspect" | "batch";

interface Props {
  active: View;
  onChange: (v: View) => void;
  userId: string;
  onLogout: () => void;
}

export function AppHeader({ active, onChange, userId, onLogout }: Props) {
  return (
    <header className="sticky top-0 z-30 w-full border-b border-border bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1400px] items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <ShieldCheck className="h-4 w-4" />
          </div>
          <div className="leading-tight">
            <div className="label-mono">QC Systems</div>
            <div className="font-semibold tracking-tight">Pre-Ship Control</div>
          </div>
        </div>
        <nav className="flex items-center gap-1 rounded-lg border border-border bg-card p-1">
          {(["dashboard", "devices", "batch", "inspect"] as const).map((v) => (
            <button
              key={v}
              onClick={() => onChange(v)}
              className={cn(
                "label-mono px-3 py-1.5 rounded-md transition-colors",
                active === v
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {v}
            </button>
          ))}
        </nav>
        <UserBadge userId={userId} onLogout={onLogout} />
      </div>
    </header>
  );
}
