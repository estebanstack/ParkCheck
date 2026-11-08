import { Suspense } from "react";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/domain/auth";
import { redirect } from "next/navigation";
import ParkCheckDashboard from "@/components/ParkCheckDashboard";
import { Loader2 } from "lucide-react";

async function ProtectedDashboard() {
  const cookieStore = await cookies();
  const token = cookieStore.get("parkcheck_session")?.value;
  const session = token ? verifySessionToken(token) : null;

  if (!session) {
    redirect("/login");
  }

  return <ParkCheckDashboard initialSession={session} />;
}

export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400 text-xs space-x-2">
          <Loader2 className="w-5 h-5 animate-spin text-emerald-400" />
          <span>Verificando credenciales de acceso...</span>
        </div>
      }
    >
      <ProtectedDashboard />
    </Suspense>
  );
}
