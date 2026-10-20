"use client";

import { useState } from "react";
import {
  Car,
  ShieldCheck,
  ClipboardList,
  AlertTriangle,
  ArrowRightLeft,
  FileSpreadsheet,
  Clock,
  LogOut,
  Radio,
  Search,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Camera,
  RefreshCw,
} from "lucide-react";

export default function ParkCheckApp() {
  // Demo active user state (default: Guard / Supervisor)
  const [currentUser, setCurrentUser] = useState({
    name: "Carlos Mendoza",
    role: "ENTRANCE_GUARD",
    complexName: "Conjunto Residencial Bosque Real",
    complexCode: "BOSQUE-REAL-01",
  });

  const [activeTab, setActiveTab] = useState<
    "gate" | "queue" | "inspection" | "incidents" | "dashboard" | "reports"
  >("gate");

  // State: Gate Movements
  const [gatePlate, setGatePlate] = useState("");
  const [gateMessage, setGateMessage] = useState<string | null>(null);
  const [gateError, setGateError] = useState<string | null>(null);

  // State: Mock live operational data
  const [metrics, setMetrics] = useState({
    insideCount: 38,
    awayCount: 14,
    uncertainCount: 2,
    pendingReturnCount: 3,
    pendingScheduledCount: 7,
    overdueCount: 2,
    failedCount: 1,
    openIncidentsCount: 2,
  });

  // State: Priority Queue Items
  const [queueItems, setQueueItems] = useState([
    {
      id: "task-ret-1",
      plate: "KHY842",
      space: "Torre 1 - P102",
      triggerType: "RETURN",
      priorityLabel: "Retorno Reciente (Prioridad)",
      priorityBucket: 1,
      presenceStatus: "INSIDE",
      dueIn: "18 mins",
      isLate: false,
    },
    {
      id: "task-sch-1",
      plate: "WLU915",
      space: "Torre 2 - P205",
      triggerType: "SCHEDULED",
      priorityLabel: "Ronda Programada",
      priorityBucket: 2,
      presenceStatus: "INSIDE",
      dueIn: "45 mins",
      isLate: false,
    },
    {
      id: "task-ovd-1",
      plate: "OVD991",
      space: "Torre 3 - P301",
      triggerType: "SCHEDULED",
      priorityLabel: "Inspección Vencida",
      priorityBucket: 3,
      presenceStatus: "INSIDE",
      dueIn: "Venció hace 22 mins",
      isLate: true,
    },
  ]);

  // Selected inspection task
  const [selectedTask, setSelectedTask] = useState<any | null>(null);
  const [inspectionResult, setInspectionResult] = useState<string>("NO_VISIBLE_INCIDENT");
  const [damageDesc, setDamageDesc] = useState("");
  const [unableReason, setUnableReason] = useState("");
  const [surveillanceReq, setSurveillanceReq] = useState(false);
  const [ownerContactReq, setOwnerContactReq] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Incidents state
  const [incidents, setIncidents] = useState([
    {
      id: "INC-2026-001",
      plate: "WLU915",
      space: "Torre 2 - P205",
      observedAt: "Hoy 16:45",
      reporter: "Jhonatan Pérez (Rondero)",
      description: "Raspón profundo en puerta trasera derecha con transferencia de pintura blanca.",
      status: "UNDER_INVESTIGATION",
      surveillanceOutcome: "Pendiente revisión de cámara perimetral P2.",
      ownerContacted: false,
    },
    {
      id: "INC-2026-002",
      plate: "KHY842",
      space: "Torre 1 - P102",
      observedAt: "Hoy 14:10",
      reporter: "Jhonatan Pérez (Rondero)",
      description: "Golpe en bómper delantero izquierdo y farola agrietada.",
      status: "OWNER_CONTACTED",
      surveillanceOutcome: "Cámara de acceso muestra que el vehículo ingresó ya con el golpe.",
      ownerContacted: true,
    },
  ]);

  // Handle Gate Movement Submission
  const handleRecordMovement = (type: "ARRIVAL" | "DEPARTURE") => {
    if (!gatePlate.trim()) {
      setGateError("Ingrese una placa válida.");
      return;
    }
    const cleanPlate = gatePlate.trim().toUpperCase();
    setGateError(null);

    if (type === "ARRIVAL") {
      setGateMessage(
        `✓ INGRESO REGISTRADO: ${cleanPlate}. Estado: DENTRO. Tarea de inspección por retorno creada y priorizada.`
      );
      setMetrics((prev) => ({
        ...prev,
        insideCount: prev.insideCount + 1,
        awayCount: Math.max(0, prev.awayCount - 1),
        pendingReturnCount: prev.pendingReturnCount + 1,
      }));
      // Prepend return task
      setQueueItems((prev) => [
        {
          id: `task-ret-${Date.now()}`,
          plate: cleanPlate,
          space: "Parqueadero Asignado",
          triggerType: "RETURN",
          priorityLabel: "Retorno Reciente (Prioridad)",
          priorityBucket: 1,
          presenceStatus: "INSIDE",
          dueIn: "30 mins",
          isLate: false,
        },
        ...prev,
      ]);
    } else {
      setGateMessage(
        `✓ SALIDA REGISTRADA: ${cleanPlate}. Estado: FUERA. Obligaciones previas preservadas en historial sin supresión.`
      );
      setMetrics((prev) => ({
        ...prev,
        insideCount: Math.max(0, prev.insideCount - 1),
        awayCount: prev.awayCount + 1,
      }));
    }
    setGatePlate("");
  };

  // Handle Inspection Submission
  const handleSubmitInspection = () => {
    if (!selectedTask) return;
    setSubmitting(true);

    setTimeout(() => {
      // Remove from queue
      setQueueItems((prev) => prev.filter((t) => t.id !== selectedTask.id));

      if (inspectionResult === "DAMAGE_OBSERVED") {
        setIncidents((prev) => [
          {
            id: `INC-2026-${Date.now().toString().slice(-3)}`,
            plate: selectedTask.plate,
            space: selectedTask.space,
            observedAt: "Justo ahora",
            reporter: currentUser.name,
            description: damageDesc || "Daño observado durante ronda.",
            status: "REPORTED",
            surveillanceOutcome: surveillanceReq ? "Revisión CCTV solicitada" : "No requerida",
            ownerContacted: false,
          },
          ...prev,
        ]);
        setMetrics((prev) => ({ ...prev, openIncidentsCount: prev.openIncidentsCount + 1 }));
      }

      setSubmitting(false);
      setSelectedTask(null);
      setDamageDesc("");
      setActiveTab("queue");
    }, 400);
  };

  return (
    <div className="flex flex-col min-h-screen bg-slate-950 text-slate-100">
      {/* Top Header */}
      <header className="border-b border-slate-800 bg-slate-900 px-4 py-3 sticky top-0 z-20 shadow-md">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-emerald-600 rounded-lg text-white shadow-emerald-500/20 shadow-lg">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-bold text-lg text-white tracking-tight">ParkCheck</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-950 border border-emerald-800 text-emerald-400 font-medium">
                  En Vivo
                </span>
              </div>
              <p className="text-xs text-slate-400 font-normal">
                {currentUser.complexName}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2 text-xs">
            {/* Quick Role Switcher for MVP Testing */}
            <select
              value={currentUser.role}
              onChange={(e) => {
                const role = e.target.value;
                setCurrentUser((u) => ({
                  ...u,
                  role,
                  name:
                    role === "ENTRANCE_GUARD"
                      ? "Carlos Mendoza (Portería)"
                      : role === "PARKING_GUARD"
                      ? "Jhonatan Pérez (Rondero)"
                      : "Mayor Restrepo (Supervisor)",
                }));
              }}
              className="bg-slate-800 border border-slate-700 text-slate-300 rounded px-2 py-1.5 focus:outline-none focus:border-emerald-500"
            >
              <option value="ENTRANCE_GUARD">Guarda Portería</option>
              <option value="PARKING_GUARD">Guarda Rondero</option>
              <option value="SUPERVISOR">Supervisor / Admin</option>
            </select>
          </div>
        </div>
      </header>

      {/* Main Body */}
      <main className="flex-1 max-w-6xl w-full mx-auto p-4 md:p-6 pb-24">
        {/* Navigation Tabs (Mobile-Friendly Pill Bar) */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-6">
          <button
            onClick={() => setActiveTab("gate")}
            className={`flex items-center justify-center space-x-2 py-2.5 px-3 rounded-lg text-xs font-medium transition ${
              activeTab === "gate"
                ? "bg-emerald-600 text-white shadow"
                : "bg-slate-900 text-slate-300 hover:bg-slate-800 border border-slate-800"
            }`}
          >
            <ArrowRightLeft className="w-4 h-4" />
            <span>Portería</span>
          </button>

          <button
            onClick={() => setActiveTab("queue")}
            className={`flex items-center justify-center space-x-2 py-2.5 px-3 rounded-lg text-xs font-medium transition relative ${
              activeTab === "queue"
                ? "bg-emerald-600 text-white shadow"
                : "bg-slate-900 text-slate-300 hover:bg-slate-800 border border-slate-800"
            }`}
          >
            <ClipboardList className="w-4 h-4" />
            <span>Cola Rondas</span>
            {queueItems.length > 0 && (
              <span className="ml-1 px-1.5 py-0.2 bg-amber-500 text-slate-950 font-bold rounded-full text-[10px]">
                {queueItems.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab("incidents")}
            className={`flex items-center justify-center space-x-2 py-2.5 px-3 rounded-lg text-xs font-medium transition ${
              activeTab === "incidents"
                ? "bg-emerald-600 text-white shadow"
                : "bg-slate-900 text-slate-300 hover:bg-slate-800 border border-slate-800"
            }`}
          >
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            <span>Incidentes</span>
          </button>

          <button
            onClick={() => setActiveTab("dashboard")}
            className={`flex items-center justify-center space-x-2 py-2.5 px-3 rounded-lg text-xs font-medium transition ${
              activeTab === "dashboard"
                ? "bg-emerald-600 text-white shadow"
                : "bg-slate-900 text-slate-300 hover:bg-slate-800 border border-slate-800"
            }`}
          >
            <Radio className="w-4 h-4" />
            <span>Métricas</span>
          </button>

          <button
            onClick={() => setActiveTab("reports")}
            className={`flex items-center justify-center space-x-2 py-2.5 px-3 rounded-lg text-xs font-medium transition ${
              activeTab === "reports"
                ? "bg-emerald-600 text-white shadow"
                : "bg-slate-900 text-slate-300 hover:bg-slate-800 border border-slate-800"
            }`}
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>Reportes CSV</span>
          </button>
        </div>

        {/* TAB 1: PORTERÍA / GATE MOVEMENTS */}
        {activeTab === "gate" && (
          <div className="space-y-6">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
              <h2 className="text-base font-semibold text-white mb-1 flex items-center space-x-2">
                <ArrowRightLeft className="w-5 h-5 text-emerald-400" />
                <span>Registro de Ingreso y Salida Vehicular</span>
              </h2>
              <p className="text-xs text-slate-400 mb-4">
                Guarda de portería: ingrese la placa del vehículo. Un ingreso genera automáticamente la tarea de inspección de retorno prioritario.
              </p>

              {gateMessage && (
                <div className="p-3 mb-4 rounded-lg bg-emerald-950/80 border border-emerald-800 text-emerald-200 text-xs">
                  {gateMessage}
                </div>
              )}

              {gateError && (
                <div className="p-3 mb-4 rounded-lg bg-red-950/80 border border-red-800 text-red-200 text-xs">
                  {gateError}
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-3 items-center">
                <div className="relative w-full">
                  <input
                    type="text"
                    value={gatePlate}
                    onChange={(e) => setGatePlate(e.target.value.toUpperCase())}
                    placeholder="Ej: ABC123"
                    maxLength={7}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3.5 text-xl font-mono text-center tracking-widest text-emerald-300 focus:outline-none focus:border-emerald-500 uppercase"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3 w-full sm:w-auto">
                  <button
                    onClick={() => handleRecordMovement("ARRIVAL")}
                    className="flex items-center justify-center space-x-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3.5 px-6 rounded-lg text-sm transition shadow-lg shadow-emerald-900/30 active:scale-95"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>INGRESO</span>
                  </button>

                  <button
                    onClick={() => handleRecordMovement("DEPARTURE")}
                    className="flex items-center justify-center space-x-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold py-3.5 px-6 rounded-lg text-sm border border-slate-700 transition active:scale-95"
                  >
                    <XCircle className="w-4 h-4 text-slate-400" />
                    <span>SALIDA</span>
                  </button>
                </div>
              </div>

              {/* Notification Banner for Entrance Guard (Owner contact follow-up) */}
              <div className="mt-6 border-t border-slate-800 pt-4">
                <div className="flex items-start space-x-3 bg-amber-950/40 border border-amber-800/60 rounded-lg p-3">
                  <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                  <div className="text-xs text-amber-200">
                    <span className="font-semibold block">Aviso a Portería — Contacto de Propietario Requerido:</span>
                    Vehículo <strong className="text-white font-mono">WLU915</strong> (Torre 2 - P205) tiene reporte de raspón en puerta trasera. Informar al conductor a la salida o ingreso.
                  </div>
                </div>
              </div>
            </div>

            {/* Quick NFC/QR Scanner Mock */}
            <div className="bg-slate-900/60 border border-dashed border-slate-800 rounded-xl p-4 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-400">
              <div className="flex items-center space-x-3 mb-2 sm:mb-0">
                <Camera className="w-5 h-5 text-emerald-400" />
                <span>Escaneo rápido de sticker NFC o código QR de vehículo</span>
              </div>
              <button
                onClick={() => {
                  setGatePlate("KHY842");
                  setGateMessage("Sticker NFC leído correctamente: Vehículo KHY842 identificado.");
                }}
                className="bg-slate-800 hover:bg-slate-700 text-emerald-400 px-3 py-1.5 rounded border border-slate-700 text-xs font-mono"
              >
                Simular Lectura NFC (KHY842)
              </button>
            </div>
          </div>
        )}

        {/* TAB 2: COLA DE INSPECCIÓN / QUEUE */}
        {activeTab === "queue" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-base font-semibold text-white flex items-center space-x-2">
                <ClipboardList className="w-5 h-5 text-emerald-400" />
                <span>Cola Priorizada de Rondas</span>
              </h2>
              <span className="text-xs text-slate-400">
                Orden: Retorno prioritario → Ronda programada → Vencidas
              </span>
            </div>

            {/* Alert Category: Uncertain Presence */}
            <div className="bg-amber-950/30 border border-amber-900/50 rounded-lg p-3 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <HelpCircle className="w-5 h-5 text-amber-400" />
                <div className="text-xs">
                  <span className="font-semibold text-amber-200">Presencia Incierta (Requiere Verificación):</span>
                  <span className="text-slate-300 ml-1">FTZ654 (Torre 3 - P301) — Placa borrosa en cámara perimetral.</span>
                </div>
              </div>
              <button
                onClick={() => alert("Estado verificado como DENTRO por el guarda.")}
                className="text-xs bg-amber-900/60 text-amber-200 hover:bg-amber-800 px-2.5 py-1 rounded border border-amber-700 font-medium"
              >
                Verificar
              </button>
            </div>

            {/* Task list */}
            <div className="space-y-3">
              {queueItems.map((item) => (
                <div
                  key={item.id}
                  className={`bg-slate-900 border rounded-xl p-4 shadow-md flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition hover:border-slate-700 ${
                    item.priorityBucket === 1
                      ? "border-emerald-600/70 bg-gradient-to-r from-emerald-950/20 to-slate-900"
                      : item.isLate
                      ? "border-red-800/80 bg-red-950/10"
                      : "border-slate-800"
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex items-center space-x-2">
                      <span className="font-mono font-bold text-lg text-white tracking-wider">
                        {item.plate}
                      </span>
                      <span
                        className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                          item.priorityBucket === 1
                            ? "bg-emerald-950 border border-emerald-700 text-emerald-300"
                            : item.isLate
                            ? "bg-red-950 border border-red-700 text-red-300"
                            : "bg-slate-800 text-slate-300"
                        }`}
                      >
                        {item.priorityLabel}
                      </span>
                    </div>
                    <div className="text-xs text-slate-400 flex items-center space-x-3">
                      <span>{item.space}</span>
                      <span>•</span>
                      <span className="flex items-center space-x-1">
                        <Clock className="w-3.5 h-3.5 text-slate-400" />
                        <span>{item.dueIn}</span>
                      </span>
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      setSelectedTask(item);
                      setActiveTab("inspection");
                    }}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs px-4 py-2.5 rounded-lg transition self-end sm:self-center shadow active:scale-95"
                  >
                    Inspeccionar Vehículo
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 3: FORMULARIO DE INSPECCIÓN */}
        {activeTab === "inspection" && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg max-w-2xl mx-auto space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h2 className="text-base font-semibold text-white">Inspección de Condición Visible</h2>
                <p className="text-xs text-slate-400">
                  Vehículo: <strong className="text-emerald-400 font-mono text-sm">{selectedTask?.plate || "KHY842"}</strong> ({selectedTask?.space || "Torre 1 - P102"})
                </p>
              </div>
              <button
                onClick={() => setActiveTab("queue")}
                className="text-xs text-slate-400 hover:text-slate-200"
              >
                Volver a la cola
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-medium mb-1.5">Resultado Observado:</label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setInspectionResult("NO_VISIBLE_INCIDENT")}
                    className={`p-3 rounded-lg border text-left flex flex-col justify-between transition ${
                      inspectionResult === "NO_VISIBLE_INCIDENT"
                        ? "bg-emerald-950/60 border-emerald-500 text-emerald-200"
                        : "bg-slate-950 border-slate-800 text-slate-400"
                    }`}
                  >
                    <span className="font-semibold text-xs">Sin Novedad</span>
                    <span className="text-[10px] text-slate-400 mt-1">Vehículo en condición visual normal.</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setInspectionResult("DAMAGE_OBSERVED")}
                    className={`p-3 rounded-lg border text-left flex flex-col justify-between transition ${
                      inspectionResult === "DAMAGE_OBSERVED"
                        ? "bg-amber-950/60 border-amber-500 text-amber-200"
                        : "bg-slate-950 border-slate-800 text-slate-400"
                    }`}
                  >
                    <span className="font-semibold text-xs text-amber-400">Daño Observado</span>
                    <span className="text-[10px] text-slate-400 mt-1">Raspón, abolladura, vidrio roto o impacto.</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setInspectionResult("UNABLE_TO_COMPLETE")}
                    className={`p-3 rounded-lg border text-left flex flex-col justify-between transition ${
                      inspectionResult === "UNABLE_TO_COMPLETE"
                        ? "bg-red-950/60 border-red-500 text-red-200"
                        : "bg-slate-950 border-slate-800 text-slate-400"
                    }`}
                  >
                    <span className="font-semibold text-xs text-red-400">No Completada</span>
                    <span className="text-[10px] text-slate-400 mt-1">Bloqueo, oscuridad o impedimento físico.</span>
                  </button>
                </div>
              </div>

              {inspectionResult === "DAMAGE_OBSERVED" && (
                <div className="space-y-3 bg-slate-950 p-4 rounded-lg border border-slate-800">
                  <div>
                    <label className="block text-slate-300 font-medium mb-1">Descripción del daño:</label>
                    <textarea
                      rows={2}
                      value={damageDesc}
                      onChange={(e) => setDamageDesc(e.target.value)}
                      placeholder="Describa ubicación y tipo de daño visible (ej: hendidura en puerta piloto)..."
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-slate-200 focus:outline-none focus:border-amber-500"
                    />
                  </div>

                  <div className="flex flex-col sm:flex-row gap-3 pt-2">
                    <label className="flex items-center space-x-2 text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={surveillanceReq}
                        onChange={(e) => setSurveillanceReq(e.target.checked)}
                        className="rounded border-slate-700 text-emerald-600 focus:ring-0"
                      />
                      <span>Solicitar revisión de cámaras de seguridad (CCTV)</span>
                    </label>

                    <label className="flex items-center space-x-2 text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={ownerContactReq}
                        onChange={(e) => setOwnerContactReq(e.target.checked)}
                        className="rounded border-slate-700 text-emerald-600 focus:ring-0"
                      />
                      <span>Notificar a portería para contactar al propietario</span>
                    </label>
                  </div>
                </div>
              )}

              {inspectionResult === "UNABLE_TO_COMPLETE" && (
                <div className="bg-slate-950 p-4 rounded-lg border border-slate-800">
                  <label className="block text-slate-300 font-medium mb-1">Motivo por el cual no se pudo inspeccionar:</label>
                  <input
                    type="text"
                    value={unableReason}
                    onChange={(e) => setUnableReason(e.target.value)}
                    placeholder="Ej: Carro tapado con pijama plástica / Bloqueado por obra"
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-slate-200 focus:outline-none focus:border-red-500"
                  />
                  <p className="text-[11px] text-amber-400 mt-1.5">
                    * Nota legal: Este reporte no satisface la inspección como completada.
                  </p>
                </div>
              )}

              <button
                onClick={handleSubmitInspection}
                disabled={submitting}
                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3 rounded-lg text-sm transition shadow-lg shadow-emerald-900/30 flex items-center justify-center space-x-2"
              >
                {submitting ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Guardar y Confirmar Inspección</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* TAB 4: GESTIÓN DE INCIDENTES */}
        {activeTab === "incidents" && (
          <div className="space-y-4">
            <h2 className="text-base font-semibold text-white flex items-center space-x-2">
              <AlertTriangle className="w-5 h-5 text-amber-400" />
              <span>Gestión y Trazabilidad de Incidentes</span>
            </h2>

            <div className="space-y-3">
              {incidents.map((inc) => (
                <div
                  key={inc.id}
                  className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-md space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <span className="font-mono font-bold text-white text-base">{inc.plate}</span>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                        {inc.id}
                      </span>
                    </div>
                    <span className="text-xs px-2.5 py-0.5 rounded-full bg-amber-950 border border-amber-800 text-amber-400 font-medium">
                      {inc.status}
                    </span>
                  </div>

                  <p className="text-xs text-slate-200">{inc.description}</p>

                  <div className="text-[11px] text-slate-400 bg-slate-950 p-2.5 rounded-lg space-y-1">
                    <div>
                      <strong className="text-slate-300">CCTV:</strong> {inc.surveillanceOutcome}
                    </div>
                    <div>
                      <strong className="text-slate-300">Contacto Propietario:</strong>{" "}
                      {inc.ownerContacted ? "Contactado y notificado" : "Pendiente de contacto"}
                    </div>
                  </div>

                  <div className="flex justify-between items-center text-[10px] text-slate-400 pt-1">
                    <span>Reportado por: {inc.reporter}</span>
                    <span>{inc.observedAt}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 5: MÉTRICAS OPERACIONALES */}
        {activeTab === "dashboard" && (
          <div className="space-y-6">
            <h2 className="text-base font-semibold text-white flex items-center space-x-2">
              <Radio className="w-5 h-5 text-emerald-400" />
              <span>Panel Operacional en Vivo</span>
            </h2>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
                <span className="text-xs text-slate-400 block mb-1">Vehículos DENTRO</span>
                <span className="text-2xl font-bold text-emerald-400 font-mono">
                  {metrics.insideCount}
                </span>
              </div>

              <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
                <span className="text-xs text-slate-400 block mb-1">Vehículos FUERA</span>
                <span className="text-2xl font-bold text-slate-300 font-mono">
                  {metrics.awayCount}
                </span>
              </div>

              <div className="bg-slate-900 border border-amber-900/40 p-4 rounded-xl bg-amber-950/10">
                <span className="text-xs text-amber-400 block mb-1">Retornos Pendientes</span>
                <span className="text-2xl font-bold text-amber-400 font-mono">
                  {metrics.pendingReturnCount}
                </span>
              </div>

              <div className="bg-slate-900 border border-red-900/40 p-4 rounded-xl bg-red-950/10">
                <span className="text-xs text-red-400 block mb-1">Inspecciones Vencidas</span>
                <span className="text-2xl font-bold text-red-400 font-mono">
                  {metrics.overdueCount}
                </span>
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl text-xs space-y-2">
              <h3 className="font-semibold text-white">Parámetros de Política del Conjunto:</h3>
              <ul className="list-disc list-inside text-slate-400 space-y-1">
                <li>Intervalo de ronda programada: <strong className="text-slate-200">60 minutos</strong></li>
                <li>Período de gracia antes de marcar vencida: <strong className="text-slate-200">15 minutos</strong></li>
                <li>Ventana de inspección de retorno: <strong className="text-slate-200">30 minutos</strong></li>
                <li>Cooldown anti-duplicados en portería: <strong className="text-slate-200">60 segundos</strong></li>
              </ul>
            </div>
          </div>
        )}

        {/* TAB 6: REPORTES CSV */}
        {activeTab === "reports" && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
            <h2 className="text-base font-semibold text-white flex items-center space-x-2">
              <FileSpreadsheet className="w-5 h-5 text-emerald-400" />
              <span>Exportación de Registros y Auditoría</span>
            </h2>
            <p className="text-xs text-slate-400">
              Descargue los registros autorizados en formato CSV compatible con Microsoft Excel y Google Sheets.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              <div className="bg-slate-950 p-4 rounded-lg border border-slate-800 flex flex-col justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-white mb-1">Historial de Inspecciones</h3>
                  <p className="text-xs text-slate-400 mb-3">
                    Incluye resultados de condición visible, timestamps exactos, guarda inspector y registro de retrasos.
                  </p>
                </div>
                <a
                  href="/api/reports/export?type=inspections"
                  className="bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs py-2.5 px-4 rounded-lg text-center transition shadow"
                >
                  Descargar CSV de Inspecciones
                </a>
              </div>

              <div className="bg-slate-950 p-4 rounded-lg border border-slate-800 flex flex-col justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-white mb-1">Registro de Movimientos (Portería)</h3>
                  <p className="text-xs text-slate-400 mb-3">
                    Log secuencial inmutable de ingresos y salidas con fuente y guarda responsable.
                  </p>
                </div>
                <a
                  href="/api/reports/export?type=movements"
                  className="bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-xs py-2.5 px-4 rounded-lg text-center border border-slate-700 transition"
                >
                  Descargar CSV de Movimientos
                </a>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
