"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ShieldCheck, Lock, Mail, AlertCircle, Loader2 } from "lucide-react";

function LoginForm() {
  const searchParams = useSearchParams();
  const redirectUrl = searchParams.get("redirect") || "/";
  const errorParam = searchParams.get("error");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(
    errorParam === "expired"
      ? "Su sesión ha expirado o no es válida. Por favor, inicie sesión nuevamente."
      : null
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setErrorMessage("Por favor ingrese su correo electrónico y contraseña.");
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setErrorMessage(data.error || "Credenciales inválidas o error de autenticación.");
        setLoading(false);
        return;
      }

      // Hard redirect to destination to ensure cookie propagation and fresh server check
      // Validate redirectUrl to prevent open redirects (e.g. "//evil.com")
      const safeRedirect =
        redirectUrl.startsWith("/") && !redirectUrl.startsWith("//")
          ? redirectUrl
          : "/";
      window.location.href = safeRedirect;
    } catch {
      setErrorMessage("Error de conexión con el servidor. Intente de nuevo.");
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl">
      <div className="flex flex-col items-center mb-6 text-center">
        <div className="w-14 h-14 bg-emerald-950/80 border border-emerald-700/60 rounded-2xl flex items-center justify-center text-emerald-400 mb-3 shadow-inner">
          <ShieldCheck className="w-8 h-8" />
        </div>
        <h1 className="text-2xl font-bold text-white tracking-tight">ParkCheck</h1>
        <p className="text-xs text-slate-400 mt-1">
          Control Operativo, Inspección Vehicular y Acceso
        </p>
      </div>

      {errorMessage && (
        <div className="mb-5 p-3 rounded-xl bg-rose-950/70 border border-rose-800/80 text-rose-300 text-xs flex items-start space-x-2.5">
          <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
          <span className="leading-relaxed">{errorMessage}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-slate-300 mb-1.5" htmlFor="login-email">
            Correo Electrónico
          </label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
              <Mail className="w-4 h-4" />
            </div>
            <input
              id="login-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="usuario@bosquereal.com"
              required
              autoComplete="email"
              disabled={loading}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 disabled:opacity-50 transition"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-300 mb-1.5" htmlFor="login-password">
            Contraseña
          </label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
              <Lock className="w-4 h-4" />
            </div>
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              required
              autoComplete="current-password"
              disabled={loading}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 disabled:opacity-50 transition"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full mt-2 bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-sm py-2.5 px-4 rounded-xl shadow-lg shadow-emerald-950/50 flex items-center justify-center space-x-2 transition disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-emerald-400"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Verificando credenciales...</span>
            </>
          ) : (
            <span>Ingresar al Sistema</span>
          )}
        </button>
      </form>

      <div className="mt-6 pt-5 border-t border-slate-800 text-[11px] text-slate-400 space-y-1.5">
        <p className="font-semibold text-slate-300 text-center">Roles y Credenciales de Operación:</p>
        <div className="bg-slate-950/60 rounded-lg p-2.5 border border-slate-800/80 space-y-1">
          <p><span className="text-emerald-400 font-mono">porteria@bosquereal.com</span> — Guarda de Portería</p>
          <p><span className="text-emerald-400 font-mono">rondas@bosquereal.com</span> — Guarda de Rondas</p>
          <p><span className="text-emerald-400 font-mono">supervisor@seguridadcolombia.com</span> — Supervisor</p>
          <p><span className="text-emerald-400 font-mono">administracion@bosquereal.com</span> — Administración</p>
          <p className="text-slate-400 pt-1">Clave general: <span className="text-slate-200 font-mono">ParkCheck2026*</span></p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center items-center p-4">
      <Suspense
        fallback={
          <div className="text-slate-400 text-sm flex items-center space-x-2">
            <Loader2 className="w-5 h-5 animate-spin text-emerald-400" />
            <span>Cargando autenticación...</span>
          </div>
        }
      >
        <LoginForm />
      </Suspense>
    </div>
  );
}
