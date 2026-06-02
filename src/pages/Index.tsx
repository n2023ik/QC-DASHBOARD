import { useState } from "react";
import { AppHeader, type View } from "@/components/qc/AppHeader";
import { QCDashboard } from "@/components/qc/QCDashboard";
import { InspectionForm } from "@/components/qc/InspectionForm";
import { DeviceGrid } from "@/components/qc/DeviceGrid";
import { StatsStrip } from "@/components/qc/StatsStrip";
import { LoginScreen, useAuth } from "@/components/qc/Auth";
import { BatchQC } from "@/components/qc/BatchQC";
import { SheetSyncDaemon } from "@/components/qc/SheetSyncDaemon";

const Index = () => {
  const [view, setView] = useState<View>("dashboard");
  const { userId, login, logout } = useAuth();

  if (!userId) return <LoginScreen onLogin={login} />;

  return (
    <div className="min-h-screen bg-background">
      <AppHeader active={view} onChange={setView} userId={userId} onLogout={logout} />
      <SheetSyncDaemon />
      <main>
        {view === "dashboard" && (
          <QCDashboard
            onNewInspection={() => setView("inspect")}
            onOpenDevice={() => setView("devices")}
          />
        )}
        {view === "devices" && (
          <>
            <StatsStrip />
            <DeviceGrid />
          </>
        )}
        {view === "batch" && <BatchQC />}
        {view === "inspect" && <InspectionForm />}
      </main>
    </div>
  );
};

export default Index;
