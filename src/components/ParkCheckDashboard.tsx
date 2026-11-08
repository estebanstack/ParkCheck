"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Car,
  ShieldCheck,
  ClipboardList,
  AlertTriangle,
  ArrowRightLeft,
  FileSpreadsheet,
  Clock,
  Radio,
  Search,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Camera,
  Phone,
  FileText,
  ArrowRight,
  Check,
  Filter,
  Eye,
} from "lucide-react";
import { SessionPayload } from "@/domain/auth";
import { DashboardTab } from "@/types/dashboard";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { DashboardHeader } from "@/components/dashboard/DashboardHeader";
import { DashboardNavigation } from "@/components/dashboard/DashboardNavigation";
import { IncidentStatusBadge } from "@/components/common/IncidentStatusBadge";

interface QueueTaskItem {
  task: {
    id: string;
    complexId: string;
    vehicleId: string;
    triggerType: "RETURN" | "SCHEDULED";
    status: "PENDING" | "OVERDUE" | "UNABLE_TO_COMPLETE";
    dueAt: string;
    isLate: boolean;
  };
  vehicle: {
    id: string;
    plate: string;
    parkingSpace: string | null;
    stickerToken: string | null;
  };
  presenceStatus: "INSIDE" | "AWAY" | "UNCERTAIN";
  priorityBucket: 1 | 2 | 3 | 4;
  priorityLabel: string;
}

interface UncertainAlert {
  vehicle: {
    id: string;
    plate: string;
    parkingSpace: string | null;
  };
  presence: {
    currentStatus: string;
    verificationDetails: string | null;
  };
}

interface VehicleRecord {
  id: string;
  plate: string;
  parkingSpace: string | null;
  stickerToken: string | null;
  presenceStatus: "INSIDE" | "AWAY" | "UNCERTAIN";
  verificationDetails: string | null;
  createdAt: string;
}

interface DashboardMetrics {
  insideCount: number;
  awayCount: number;
  uncertainCount: number;
  pendingReturnCount: number;
  pendingScheduledCount: number;
  overdueCount: number;
  failedCount: number;
  openIncidentsCount: number;
}

interface IncidentItem {
  id: string;
  complexId?: string;
  vehicleId?: string;
  inspectionRecordId?: string | null;
  observedAt: string;
  description: string;
  status: string;
  surveillanceRequired: boolean;
  surveillanceOutcome?: string | null;
  ownerContactRequired: boolean;
  ownerContactedAt?: string | null;
  ownerContactNotes?: string | null;
  resolutionNotes?: string | null;
  resolvedAt?: string | null;
  createdAt?: string;
  updatedAt: string;
  vehicle: {
    id?: string;
    plate: string;
    parkingSpace: string | null;
  };
  reportedBy: {
    id?: string;
    name: string;
    email: string;
  };
  followUps?: Array<{
    id: string;
    actionType: string;
    description: string;
    performedAt: string;
    outcome?: string | null;
    performedBy?: {
      id?: string;
      name: string;
    };
  }>;
  attachments?: Array<{
    id: string;
    originalName: string;
    mimeType: string;
    fileSize: number;
    attachmentType: string;
    uploadedAt: string;
    storageKey: string;
  }>;
}

interface Props {
  initialSession: SessionPayload;
}

export default function ParkCheckDashboard({ initialSession }: Props) {
  const [currentUser] = useState<SessionPayload>(initialSession);
  const [activeTab, setActiveTab] = useState<DashboardTab>("gate");

  // Authorization flags
  const canRecordMovements =
    currentUser.role === "ENTRANCE_GUARD" ||
    currentUser.role === "SUPERVISOR" ||
    currentUser.role === "PLATFORM_ADMIN";

  const canPerformInspections =
    currentUser.role === "PARKING_GUARD" ||
    currentUser.role === "SUPERVISOR" ||
    currentUser.role === "PLATFORM_ADMIN";

  const canRegisterVehicles =
    currentUser.role === "SUPERVISOR" ||
    currentUser.role === "RESIDENTIAL_ADMIN" ||
    currentUser.role === "PLATFORM_ADMIN";

  const canExportReports =
    currentUser.role === "SUPERVISOR" ||
    currentUser.role === "RESIDENTIAL_ADMIN" ||
    currentUser.role === "PLATFORM_ADMIN";

  // State: Gate Movements
  const [gatePlate, setGatePlate] = useState("");
  const [gateMessage, setGateMessage] = useState<string | null>(null);
  const [gateError, setGateError] = useState<string | null>(null);
  const [gateWarning, setGateWarning] = useState<string | null>(null);
  const [movementLoading, setMovementLoading] = useState(false);

  // State: Metrics
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(true);
  const [metricsError, setMetricsError] = useState<string | null>(null);

  // State: Queue
  const [queueItems, setQueueItems] = useState<QueueTaskItem[]>([]);
  const [uncertainAlerts, setUncertainAlerts] = useState<UncertainAlert[]>([]);
  const [queueLoading, setQueueLoading] = useState(true);
  const [queueError, setQueueError] = useState<string | null>(null);

  // State: Inspection submission
  const [selectedTask, setSelectedTask] = useState<QueueTaskItem | null>(null);
  const [inspectionResult, setInspectionResult] = useState<
    "NO_VISIBLE_INCIDENT" | "DAMAGE_OBSERVED" | "UNABLE_TO_COMPLETE"
  >("NO_VISIBLE_INCIDENT");
  const [damageDesc, setDamageDesc] = useState("");
  const [unableReason, setUnableReason] = useState("");
  const [surveillanceReq, setSurveillanceReq] = useState(false);
  const [ownerContactReq, setOwnerContactReq] = useState(false);
  const [inspectionSubmitting, setInspectionSubmitting] = useState(false);
  const [inspectionSuccessMsg, setInspectionSuccessMsg] = useState<string | null>(null);
  const [inspectionError, setInspectionError] = useState<string | null>(null);

  // Authorization flag for incident management
  const canManageIncidents =
    currentUser.role === "SUPERVISOR" ||
    currentUser.role === "RESIDENTIAL_ADMIN" ||
    currentUser.role === "PLATFORM_ADMIN";

  // State: Incidents
  const [incidents, setIncidents] = useState<IncidentItem[]>([]);
  const [incidentsLoading, setIncidentsLoading] = useState(true);
  const [incidentsError, setIncidentsError] = useState<string | null>(null);

  // State: Phase 3 Supervisor Incident Controls
  const [selectedIncident, setSelectedIncident] = useState<IncidentItem | null>(null);
  const [incidentStatusFilter, setIncidentStatusFilter] = useState<string>("ALL");
  const [incidentSearch, setIncidentSearch] = useState<string>("");
  const [incidentActionType, setIncidentActionType] = useState<
    "NOTE" | "SURVEILLANCE" | "OWNER_CONTACT" | "STATUS_TRANSITION" | "RESOLVE" | "CLOSE" | null
  >(null);
  const [actionNotes, setActionNotes] = useState("");
  const [cctvOutcome, setCctvOutcome] = useState("");
  const [cctvObservations, setCctvObservations] = useState("");
  const [cctvAdvanceStatus, setCctvAdvanceStatus] = useState(false);
  const [contactMethod, setContactMethod] = useState("INTERCOM");
  const [contactSuccessful, setContactSuccessful] = useState(true);
  const [contactNextAction, setContactNextAction] = useState("");
  const [targetStatus, setTargetStatus] = useState<string>("");
  const [incidentSubmitting, setIncidentSubmitting] = useState(false);
  const [incidentActionMsg, setIncidentActionMsg] = useState<string | null>(null);
  const [incidentActionErr, setIncidentActionErr] = useState<string | null>(null);

  // State: Vehicles
  const [vehicles, setVehicles] = useState<VehicleRecord[]>([]);
  const [vehiclePage, setVehiclePage] = useState(1);
  const [vehicleTotalPages, setVehicleTotalPages] = useState(1);
  const [vehicleTotal, setVehicleTotal] = useState(0);
  const [vehicleSearch, setVehicleSearch] = useState("");
  const [vehiclesLoading, setVehiclesLoading] = useState(true);
  const [vehiclesError, setVehiclesError] = useState<string | null>(null);

  // State: Vehicle Registration
  const [newPlate, setNewPlate] = useState("");
  const [newSpace, setNewSpace] = useState("");
  const [newStickerToken, setNewStickerToken] = useState("");
  const [newPresence, setNewPresence] = useState<"INSIDE" | "AWAY">("INSIDE");
  const [regMsg, setRegMsg] = useState<string | null>(null);
  const [regErr, setRegErr] = useState<string | null>(null);
  const [regLoading, setRegLoading] = useState(false);

  // State: Report export
  const [exportType, setExportType] = useState<"inspections" | "movements" | "incidents">("inspections");

  // Helper: check session expiry on any 401
  const handleUnauthorized = useCallback(() => {
    window.location.href = "/login?error=expired";
  }, []);

  // Fetch Metrics
  const fetchMetrics = useCallback(async () => {
    try {
      const res = await fetch("/api/dashboard/metrics");
      if (res.status === 401) {
        handleUnauthorized();
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Error al cargar métricas");
      }
      setMetrics(data.metrics);
      setMetricsError(null);
    } catch (err: any) {
      setMetricsError(err.message || "Error al conectar con métricas");
    } finally {
      setMetricsLoading(false);
    }
  }, [handleUnauthorized]);

  // Fetch Queue
  const fetchQueue = useCallback(async () => {
    try {
      const res = await fetch("/api/inspections/queue");
      if (res.status === 401) {
        handleUnauthorized();
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Error al cargar cola de inspección");
      }
      setQueueItems(data.items || []);
      setUncertainAlerts(data.uncertainAlerts || []);
      setQueueError(null);
    } catch (err: any) {
      setQueueError(err.message || "Error al conectar con la cola de inspección");
    } finally {
      setQueueLoading(false);
    }
  }, [handleUnauthorized]);

  // Fetch Incidents
  const fetchIncidents = useCallback(async () => {
    try {
      setIncidentsLoading(true);
      const res = await fetch("/api/incidents");
      if (res.status === 401) {
        handleUnauthorized();
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Error al listar incidentes");
      }
      const fetched: IncidentItem[] = data.incidents || [];
      setIncidents(fetched);
      setSelectedIncident((prev) => {
        if (!prev) return null;
        const found = fetched.find((i) => i.id === prev.id);
        return found || prev;
      });
      setIncidentsError(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error al cargar incidentes";
      setIncidentsError(msg);
    } finally {
      setIncidentsLoading(false);
    }
  }, [handleUnauthorized]);


  // Permitted next status transitions
  const getPermittedTransitions = (status: string) => {
    switch (status) {
      case "REPORTED":
        return [
          { status: "AWAITING_REVIEW", label: "Poner en Revisión (AWAITING_REVIEW)" },
          { status: "UNDER_INVESTIGATION", label: "Iniciar Investigación (UNDER_INVESTIGATION)" },
        ];
      case "AWAITING_REVIEW":
        return [
          { status: "UNDER_INVESTIGATION", label: "Iniciar Investigación (UNDER_INVESTIGATION)" },
          { status: "OWNER_CONTACT_PENDING", label: "Requerir Contacto (OWNER_CONTACT_PENDING)" },
          { status: "RESOLVED", label: "Resolver Directamente (RESOLVED)" },
        ];
      case "UNDER_INVESTIGATION":
        return [
          { status: "OWNER_CONTACT_PENDING", label: "Contacto Pendiente (OWNER_CONTACT_PENDING)" },
          { status: "OWNER_CONTACTED", label: "Propietario Contactado (OWNER_CONTACTED)" },
          { status: "RESOLVED", label: "Resolver Incidente (RESOLVED)" },
        ];
      case "OWNER_CONTACT_PENDING":
        return [
          { status: "OWNER_CONTACTED", label: "Propietario Contactado (OWNER_CONTACTED)" },
          { status: "UNDER_INVESTIGATION", label: "Retornar a Investigación (UNDER_INVESTIGATION)" },
          { status: "RESOLVED", label: "Resolver Incidente (RESOLVED)" },
        ];
      case "OWNER_CONTACTED":
        return [
          { status: "RESOLVED", label: "Resolver Incidente (RESOLVED)" },
          { status: "UNDER_INVESTIGATION", label: "Reabrir Investigación (UNDER_INVESTIGATION)" },
          { status: "OWNER_CONTACT_PENDING", label: "Requerir Nuevo Contacto (OWNER_CONTACT_PENDING)" },
        ];
      case "RESOLVED":
        return [{ status: "CLOSED", label: "Cerrar Formalmente (CLOSED)" }];
      default:
        return [];
    }
  };

  // Execute supervisor action on incident
  const handleExecuteIncidentAction = async () => {
    if (!selectedIncident || !incidentActionType) return;
    setIncidentSubmitting(true);
    setIncidentActionErr(null);
    setIncidentActionMsg(null);

    try {
      let payload: Record<string, unknown> = {
        incidentId: selectedIncident.id,
        expectedUpdatedAt: selectedIncident.updatedAt,
      };

      if (incidentActionType === "NOTE") {
        if (!actionNotes.trim()) {
          throw new Error("El texto de la nota de investigación es obligatorio.");
        }
        payload = {
          ...payload,
          action: "NOTE",
          notes: actionNotes.trim(),
          nextAction: contactNextAction.trim() || undefined,
        };
      } else if (incidentActionType === "SURVEILLANCE") {
        if (!cctvOutcome.trim()) {
          throw new Error("El resultado de la revisión de cámaras es obligatorio.");
        }
        payload = {
          ...payload,
          action: "SURVEILLANCE",
          outcome: cctvOutcome.trim(),
          notes: cctvObservations.trim() || undefined,
          advanceToUnderInvestigation: cctvAdvanceStatus,
        };
      } else if (incidentActionType === "OWNER_CONTACT") {
        if (selectedIncident.status === "REPORTED") {
          throw new Error("El contacto con propietario no está permitido directamente desde el estado REPORTADO según el ciclo de vida oficial.");
        }
        if (!actionNotes.trim()) {
          throw new Error("Las notas o respuesta del propietario son obligatorias.");
        }
        payload = {
          ...payload,
          action: "OWNER_CONTACT",
          contactSuccessful,
          contactMethod,
          notes: actionNotes.trim(),
          nextAction: contactNextAction.trim() || undefined,
        };
      } else if (incidentActionType === "STATUS_TRANSITION") {
        if (!targetStatus) {
          throw new Error("Debe seleccionar el estado de destino.");
        }
        payload = {
          ...payload,
          action: "STATUS_TRANSITION",
          newStatus: targetStatus,
          notes: actionNotes.trim() || undefined,
        };
      } else if (incidentActionType === "RESOLVE") {
        const permitted = getPermittedTransitions(selectedIncident.status);
        if (!permitted.some((p) => p.status === "RESOLVED")) {
          throw new Error(
            `La resolución no está permitida para el estado actual (${selectedIncident.status}) según el ciclo de vida oficial.`
          );
        }
        if (!actionNotes.trim()) {
          throw new Error("Las notas de resolución son obligatorias para marcar el incidente como RESUELTO.");
        }
        payload = {
          ...payload,
          action: "STATUS_TRANSITION",
          newStatus: "RESOLVED",
          notes: actionNotes.trim(),
        };
      } else if (incidentActionType === "CLOSE") {
        if (!actionNotes.trim()) {
          throw new Error("La justificación o nota de cierre es obligatoria para archivar como CERRADO.");
        }
        payload = {
          ...payload,
          action: "STATUS_TRANSITION",
          newStatus: "CLOSED",
          notes: actionNotes.trim(),
        };
      }

      const res = await fetch("/api/incidents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        if (res.status === 409) {
          try {
            const singleRes = await fetch(`/api/incidents/${selectedIncident.id}`);
            if (singleRes.ok) {
              const singleData = await singleRes.json();
              if (singleData.incident) {
                setSelectedIncident(singleData.incident);
              }
            }
          } catch {
            // fallback to list refresh
          }
          await fetchIncidents();
          throw new Error(
            "Conflicto de concurrencia: el incidente fue modificado por otro rondero o supervisor. Los datos más recientes han sido recargados."
          );
        }
        throw new Error(data.error || "Error al procesar la acción sobre el incidente.");
      }

      setIncidentActionMsg("Acción registrada exitosamente en el expediente.");
      setActionNotes("");
      setCctvOutcome("");
      setCctvObservations("");
      setCctvAdvanceStatus(false);
      setContactNextAction("");
      setTargetStatus("");
      setIncidentActionType(null);

      await fetchIncidents();
      fetchMetrics();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error al procesar la acción";
      setIncidentActionErr(msg);
    } finally {
      setIncidentSubmitting(false);
    }
  };

  // Fetch Vehicles
  const fetchVehicles = useCallback(async (page = 1, search = "") => {
    try {
      const queryParams = new URLSearchParams({
        page: page.toString(),
        limit: "10",
      });
      if (search.trim()) {
        queryParams.set("search", search.trim());
      }
      const res = await fetch(`/api/vehicles?${queryParams.toString()}`);
      if (res.status === 401) {
        handleUnauthorized();
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Error al consultar censo vehicular");
      }
      setVehicles(data.vehicles || []);
      setVehiclePage(data.pagination.page);
      setVehicleTotalPages(data.pagination.totalPages);
      setVehicleTotal(data.pagination.total);
      setVehiclesError(null);
    } catch (err: any) {
      setVehiclesError(err.message || "Error al cargar censo vehicular");
    } finally {
      setVehiclesLoading(false);
    }
  }, [handleUnauthorized]);

  // Initial data load using canonical async effect pattern
  useEffect(() => {
    let active = true;

    const loadInitialData = async () => {
      try {
        const [resM, resQ, resV, resI] = await Promise.all([
          fetch("/api/dashboard/metrics"),
          fetch("/api/inspections/queue"),
          fetch("/api/vehicles?page=1&limit=10"),
          fetch("/api/incidents"),
        ]);

        if (
          resM.status === 401 ||
          resQ.status === 401 ||
          resV.status === 401 ||
          resI.status === 401
        ) {
          handleUnauthorized();
          return;
        }

        const [dataM, dataQ, dataV, dataI] = await Promise.all([
          resM.json(),
          resQ.json(),
          resV.json(),
          resI.json(),
        ]);

        if (!active) return;

        if (dataM.metrics) setMetrics(dataM.metrics);
        if (dataQ.items) setQueueItems(dataQ.items);
        if (dataQ.uncertainAlerts) setUncertainAlerts(dataQ.uncertainAlerts);
        if (dataV.vehicles) {
          setVehicles(dataV.vehicles);
          setVehicleTotal(dataV.pagination?.total || 0);
          setVehicleTotalPages(dataV.pagination?.totalPages || 1);
        }
        if (dataI.incidents) setIncidents(dataI.incidents);
      } catch (err: any) {
        if (!active) return;
        setMetricsError(err.message || "Error al cargar datos iniciales");
      } finally {
        if (active) {
          setMetricsLoading(false);
          setQueueLoading(false);
          setVehiclesLoading(false);
          setIncidentsLoading(false);
        }
      }
    };

    loadInitialData();

    return () => {
      active = false;
    };
  }, [handleUnauthorized]);

  // Handle Logout
  const handleLogout = async () => {
    try {
      await fetch("/api/auth/session", { method: "POST" });
    } finally {
      window.location.href = "/login";
    }
  };

  // Handle Gate Movement Submission (Real API)
  const handleRecordMovement = async (type: "ARRIVAL" | "DEPARTURE") => {
    if (!gatePlate.trim()) {
      setGateError("Ingrese una placa válida.");
      return;
    }

    setMovementLoading(true);
    setGateMessage(null);
    setGateError(null);
    setGateWarning(null);

    try {
      const res = await fetch("/api/movements/record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plate: gatePlate.trim().toUpperCase(),
          eventType: type,
          source: "GATE_MANUAL",
        }),
      });

      if (res.status === 401) {
        handleUnauthorized();
        return;
      }

      const data = await res.json();

      if (res.status === 409) {
        // Authoritative duplicate movement rejection
        setGateWarning(data.error || "Movimiento duplicado ignorado por intervalo de seguridad.");
        return;
      }

      if (!res.ok) {
        setGateError(data.error || "Error al registrar movimiento.");
        return;
      }

      // Authoritative success
      const actionText = type === "ARRIVAL" ? "Ingreso" : "Salida";
      const taskNotice = data.returnTaskCreated ? " Tarea de retorno creada y priorizada en cola." : "";
      const reviewNotice = data.reviewNotice ? ` ${data.reviewNotice}` : "";

      setGateMessage(
        `✓ ${actionText} registrado: ${data.movement.plate}. Presencia: ${data.movement.presence}.${taskNotice}${reviewNotice}`
      );
      setGatePlate("");

      // Authoritative state refresh from backend
      fetchMetrics();
      fetchQueue();
      fetchVehicles(vehiclePage, vehicleSearch);
    } catch (err: any) {
      setGateError(err.message || "Error de conexión al registrar movimiento.");
    } finally {
      setMovementLoading(false);
    }
  };

  // Handle Inspection Submission (Real API)
  const handleSubmitInspection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTask) return;

    if (inspectionResult === "DAMAGE_OBSERVED" && !damageDesc.trim()) {
      setInspectionError("Debe ingresar la descripción detallada del daño observado.");
      return;
    }

    if (inspectionResult === "UNABLE_TO_COMPLETE" && !unableReason.trim()) {
      setInspectionError("Debe especificar el motivo por el cual no fue posible completar la inspección.");
      return;
    }

    setInspectionSubmitting(true);
    setInspectionError(null);
    setInspectionSuccessMsg(null);

    try {
      const res = await fetch("/api/inspections/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: selectedTask.task.id,
          result: inspectionResult,
          description: damageDesc.trim() || undefined,
          unableToCompleteReason: unableReason.trim() || undefined,
          surveillanceRequired: surveillanceReq,
          ownerContactRequired: ownerContactReq,
        }),
      });

      if (res.status === 401) {
        handleUnauthorized();
        return;
      }

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Error al enviar resultado de inspección");
      }

      setInspectionSuccessMsg(
        `✓ Inspección registrada para vehículo ${selectedTask.vehicle.plate}. Estado: ${data.task.status}.${
          data.incident ? " Incidente registrado con folio #" + data.incident.id.slice(0, 8) : ""
        }`
      );

      // Reset form
      setSelectedTask(null);
      setDamageDesc("");
      setUnableReason("");
      setSurveillanceReq(false);
      setOwnerContactReq(false);

      // Refresh real backend data
      fetchQueue();
      fetchMetrics();
      fetchIncidents();

      // Return to queue tab after short delay
      setTimeout(() => {
        setActiveTab("queue");
      }, 1500);
    } catch (err: any) {
      setInspectionError(err.message || "Error al registrar inspección");
    } finally {
      setInspectionSubmitting(false);
    }
  };

  // Handle Vehicle Registration (Real API)
  const handleRegisterVehicle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPlate.trim()) return;

    setRegLoading(true);
    setRegMsg(null);
    setRegErr(null);

    try {
      const res = await fetch("/api/vehicles/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plate: newPlate.trim().toUpperCase(),
          parkingSpace: newSpace.trim() || undefined,
          stickerToken: newStickerToken.trim() || undefined,
          initialPresence: newPresence,
        }),
      });

      if (res.status === 401) {
        handleUnauthorized();
        return;
      }

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Error al registrar vehículo");
      }

      setRegMsg(`✓ Vehículo ${data.vehicle.plate} registrado exitosamente en el censo.`);
      setNewPlate("");
      setNewSpace("");
      setNewStickerToken("");

      // Refresh real vehicle list
      fetchVehicles(1, "");
      fetchMetrics();
    } catch (err: any) {
      setRegErr(err.message || "Error al registrar");
    } finally {
      setRegLoading(false);
    }
  };

  // Handle Vehicle Search
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchVehicles(1, vehicleSearch);
  };

  const handleClearSearch = () => {
    setVehicleSearch("");
    fetchVehicles(1, "");
  };

  return (
    <DashboardShell
      header={<DashboardHeader user={currentUser} onLogout={handleLogout} />}
      navigation={
        <DashboardNavigation
          activeTab={activeTab}
          onTabChange={setActiveTab}
          queueCount={queueItems.length}
          hasUrgentQueue={queueItems.some((i) => i.priorityBucket === 1)}
          incidentsCount={incidents.length}
          userRole={currentUser.role}
        />
      }
    >

        {/* TAB 1: PORTERÍA / GATE MOVEMENTS */}
        {activeTab === "gate" && (
          <div className="space-y-6">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
              <h2 className="text-base font-semibold text-white flex items-center space-x-2 mb-2">
                <ArrowRightLeft className="w-5 h-5 text-emerald-400" />
                <span>Control de Accesos en Portería</span>
              </h2>
              <p className="text-xs text-slate-400 mb-4">
                Registre eventos reales de ingreso o salida vehicular. Las operaciones se envían a la base de datos oficial, actualizando la presencia de forma ortogonal y generando tareas de inspección de retorno inmediatas.
              </p>

              {!canRecordMovements && (
                <div className="mb-4 p-3 rounded-lg bg-amber-950/60 border border-amber-800/80 text-amber-300 text-xs flex items-center space-x-2">
                  <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0" />
                  <span>Su rol ({currentUser.role}) no tiene autorización para registrar movimientos en portería.</span>
                </div>
              )}

              {gateMessage && (
                <div className="mb-4 p-3 rounded-lg bg-emerald-950/80 border border-emerald-800 text-emerald-300 text-xs flex items-center space-x-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                  <span>{gateMessage}</span>
                </div>
              )}

              {gateWarning && (
                <div className="mb-4 p-3 rounded-lg bg-amber-950/80 border border-amber-800 text-amber-300 text-xs flex items-center space-x-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
                  <span>{gateWarning}</span>
                </div>
              )}

              {gateError && (
                <div className="mb-4 p-3 rounded-lg bg-rose-950/80 border border-rose-800 text-rose-300 text-xs flex items-center space-x-2">
                  <XCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
                  <span>{gateError}</span>
                </div>
              )}

              <div className="max-w-md space-y-4">
                <div>
                  <label className="block text-xs text-slate-400 mb-1" htmlFor="gate-plate-input">
                    Placa del Vehículo (Colombia: 3 letras y 3 números o 2 letras/4 dígitos)
                  </label>
                  <input
                    id="gate-plate-input"
                    type="text"
                    value={gatePlate}
                    onChange={(e) => setGatePlate(e.target.value.toUpperCase())}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && canRecordMovements && !movementLoading) {
                        handleRecordMovement("ARRIVAL");
                      }
                    }}
                    placeholder="Ej: ABC123"
                    maxLength={7}
                    disabled={!canRecordMovements || movementLoading}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white font-mono uppercase focus:outline-none focus:border-emerald-500 text-sm disabled:opacity-50"
                  />
                </div>

                <div className="flex space-x-3">
                  <button
                    onClick={() => handleRecordMovement("ARRIVAL")}
                    disabled={!canRecordMovements || movementLoading || !gatePlate.trim()}
                    className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs py-2.5 px-4 rounded-lg transition shadow disabled:opacity-50 flex items-center justify-center space-x-1.5"
                  >
                    {movementLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        <CheckCircle2 className="w-4 h-4" />
                        <span>Registrar Ingreso (ARRIVAL)</span>
                      </>
                    )}
                  </button>

                  <button
                    onClick={() => handleRecordMovement("DEPARTURE")}
                    disabled={!canRecordMovements || movementLoading || !gatePlate.trim()}
                    className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-medium text-xs py-2.5 px-4 rounded-lg transition disabled:opacity-50 flex items-center justify-center space-x-1.5"
                  >
                    {movementLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        <ArrowRightLeft className="w-4 h-4" />
                        <span>Registrar Salida (DEPARTURE)</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* Quick State Summary Card */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  Resumen Operativo en Tiempo Real
                </h3>
                <button
                  onClick={fetchMetrics}
                  disabled={metricsLoading}
                  className="text-xs text-slate-400 hover:text-emerald-400 flex items-center space-x-1"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${metricsLoading ? "animate-spin" : ""}`} />
                  <span>Actualizar</span>
                </button>
              </div>

              {metricsLoading && !metrics ? (
                <div className="py-6 text-center text-slate-500 text-xs flex items-center justify-center space-x-2">
                  <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
                  <span>Consultando base de datos...</span>
                </div>
              ) : metrics ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                    <span className="text-[10px] text-slate-400 block">Vehículos Dentro</span>
                    <span className="text-lg font-bold text-emerald-400">{metrics.insideCount}</span>
                  </div>
                  <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                    <span className="text-[10px] text-slate-400 block">Vehículos Fuera</span>
                    <span className="text-lg font-bold text-blue-400">{metrics.awayCount}</span>
                  </div>
                  <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                    <span className="text-[10px] text-slate-400 block">Retornos Pendientes</span>
                    <span className="text-lg font-bold text-amber-400">{metrics.pendingReturnCount}</span>
                  </div>
                  <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                    <span className="text-[10px] text-slate-400 block">Incidentes Abiertos</span>
                    <span className="text-lg font-bold text-rose-400">{metrics.openIncidentsCount}</span>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-slate-500">Métricas no disponibles temporalmente.</p>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: COLA DE RONDAS / QUEUE */}
        {activeTab === "queue" && (
          <div className="space-y-6">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <div>
                  <h2 className="text-base font-semibold text-white flex items-center space-x-2">
                    <ClipboardList className="w-5 h-5 text-emerald-400" />
                    <span>Cola de Inspección Priorizada (Rondas)</span>
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Priorización determinista: 1) Retornos de alta prioridad, 2) Rondas programadas, 3) Tareas vencidas.
                  </p>
                </div>
                <button
                  onClick={fetchQueue}
                  disabled={queueLoading}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs px-3 py-1.5 rounded-lg flex items-center space-x-1.5 transition disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${queueLoading ? "animate-spin" : ""}`} />
                  <span>Refrescar Cola</span>
                </button>
              </div>

              {queueError && (
                <div className="mb-4 p-3 rounded-lg bg-rose-950/80 border border-rose-800 text-rose-300 text-xs flex items-center space-x-2">
                  <XCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
                  <span>{queueError}</span>
                </div>
              )}

              {/* Uncertain Alerts Box */}
              {uncertainAlerts.length > 0 && (
                <div className="mb-4 p-4 rounded-xl bg-amber-950/40 border border-amber-800/80 space-y-2">
                  <div className="flex items-center space-x-2 text-amber-300 text-xs font-semibold">
                    <AlertTriangle className="w-4 h-4 text-amber-400" />
                    <span>Vehículos con Presencia Incierta ({uncertainAlerts.length})</span>
                  </div>
                  <p className="text-[11px] text-amber-200/80">
                    Requieren verificación física del rondero en el espacio asignado:
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 pt-1">
                    {uncertainAlerts.map((ua) => (
                      <div
                        key={ua.vehicle.id}
                        className="bg-slate-900/90 border border-amber-800/50 rounded-lg p-2.5 text-xs"
                      >
                        <p className="font-mono font-bold text-white">{ua.vehicle.plate}</p>
                        <p className="text-[11px] text-slate-400">{ua.vehicle.parkingSpace || "Sin espacio asignado"}</p>
                        {ua.presence.verificationDetails && (
                          <p className="text-[10px] text-amber-400/90 mt-1 italic">
                            {ua.presence.verificationDetails}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Queue Items List */}
              {queueLoading ? (
                <div className="py-12 text-center text-slate-500 text-xs flex flex-col items-center justify-center space-y-2">
                  <Loader2 className="w-6 h-6 animate-spin text-emerald-400" />
                  <span>Cargando cola de trabajo del servidor...</span>
                </div>
              ) : queueItems.length === 0 ? (
                <div className="py-12 text-center bg-slate-950/50 rounded-xl border border-slate-800/60 p-6">
                  <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2 opacity-80" />
                  <p className="text-sm font-medium text-white">No hay tareas de inspección pendientes</p>
                  <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
                    La cola se nutre automáticamente al registrar ingresos en portería o mediante el programador cron de rondas periódicas.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {queueItems.map((item) => {
                    const isReturn = item.priorityBucket === 1;
                    const isOverdue = item.priorityBucket === 3;
                    return (
                      <div
                        key={item.task.id}
                        className={`p-4 rounded-xl border transition flex flex-col justify-between ${
                          isReturn
                            ? "bg-amber-950/20 border-amber-800/60 hover:border-amber-700"
                            : isOverdue
                            ? "bg-rose-950/20 border-rose-800/60 hover:border-rose-700"
                            : "bg-slate-950 border-slate-800 hover:border-slate-700"
                        }`}
                      >
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                isReturn
                                  ? "bg-amber-950 text-amber-400 border border-amber-800"
                                  : isOverdue
                                  ? "bg-rose-950 text-rose-400 border border-rose-800"
                                  : "bg-slate-800 text-slate-300 border border-slate-700"
                              }`}
                            >
                              {item.priorityLabel}
                            </span>
                            <span className="text-[11px] text-slate-400 flex items-center space-x-1">
                              <Clock className="w-3 h-3" />
                              <span>Vence: {new Date(item.task.dueAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                            </span>
                          </div>

                          <div className="flex items-baseline justify-between mb-2">
                            <h3 className="text-lg font-mono font-bold text-white tracking-wider">
                              {item.vehicle.plate}
                            </h3>
                            <span
                              className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                                item.presenceStatus === "INSIDE"
                                  ? "bg-emerald-950/80 text-emerald-400 border border-emerald-800"
                                  : item.presenceStatus === "AWAY"
                                  ? "bg-blue-950/80 text-blue-400 border border-blue-800"
                                  : "bg-rose-950/80 text-rose-400 border border-rose-800"
                              }`}
                            >
                              {item.presenceStatus}
                            </span>
                          </div>

                          <p className="text-xs text-slate-300">
                            Espacio: <span className="text-white font-medium">{item.vehicle.parkingSpace || "Sin espacio asignado"}</span>
                          </p>
                          {item.vehicle.stickerToken && (
                            <p className="text-[11px] text-slate-500 font-mono mt-0.5">
                              NFC: {item.vehicle.stickerToken}
                            </p>
                          )}
                        </div>

                        <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-end">
                          <button
                            onClick={() => {
                              setSelectedTask(item);
                              setInspectionResult("NO_VISIBLE_INCIDENT");
                              setDamageDesc("");
                              setUnableReason("");
                              setActiveTab("inspection");
                            }}
                            disabled={!canPerformInspections}
                            className="bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs py-1.5 px-4 rounded-lg transition disabled:opacity-50"
                          >
                            Inspeccionar Vehículo
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: REGISTRO DE INSPECCIÓN / FORM */}
        {activeTab === "inspection" && (
          <div className="space-y-6">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
              <h2 className="text-base font-semibold text-white flex items-center space-x-2 mb-2">
                <Radio className="w-5 h-5 text-emerald-400" />
                <span>Formulario Oficial de Inspección en Terreno</span>
              </h2>
              <p className="text-xs text-slate-400 mb-4">
                El rondero verifica el estado del vehículo en su ubicación física y reporta observaciones o daños visibles de manera inmutable.
              </p>

              {!canPerformInspections && (
                <div className="mb-4 p-3 rounded-lg bg-amber-950/60 border border-amber-800/80 text-amber-300 text-xs flex items-center space-x-2">
                  <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0" />
                  <span>Su rol actual ({currentUser.role}) no tiene autorización para enviar inspecciones.</span>
                </div>
              )}

              {inspectionSuccessMsg && (
                <div className="mb-4 p-3 rounded-lg bg-emerald-950/80 border border-emerald-800 text-emerald-300 text-xs flex items-center space-x-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                  <span>{inspectionSuccessMsg}</span>
                </div>
              )}

              {inspectionError && (
                <div className="mb-4 p-3 rounded-lg bg-rose-950/80 border border-rose-800 text-rose-300 text-xs flex items-center space-x-2">
                  <XCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
                  <span>{inspectionError}</span>
                </div>
              )}

              {!selectedTask ? (
                <div className="py-12 text-center bg-slate-950/50 rounded-xl border border-slate-800/60 p-6">
                  <ClipboardList className="w-8 h-8 text-slate-500 mx-auto mb-2 opacity-60" />
                  <p className="text-sm font-medium text-white">Ninguna tarea seleccionada</p>
                  <p className="text-xs text-slate-400 mt-1 mb-4">
                    Seleccione un vehículo desde la cola de rondas para iniciar la inspección.
                  </p>
                  <button
                    onClick={() => setActiveTab("queue")}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium py-2 px-4 rounded-lg transition"
                  >
                    Ver Cola de Rondas
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSubmitInspection} className="max-w-xl space-y-5">
                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-[10px] text-slate-400 block">Vehículo Seleccionado</span>
                        <span className="text-xl font-mono font-bold text-white tracking-wider">
                          {selectedTask.vehicle.plate}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] text-slate-400 block">Ubicación / Espacio</span>
                        <span className="text-sm font-medium text-emerald-400">
                          {selectedTask.vehicle.parkingSpace || "Sin espacio asignado"}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-2">
                      Resultado de la Observación
                    </label>
                    <div className="space-y-2">
                      <label className="flex items-center space-x-3 bg-slate-950 border border-slate-800 p-3 rounded-lg cursor-pointer hover:border-slate-700 transition">
                        <input
                          type="radio"
                          name="result"
                          value="NO_VISIBLE_INCIDENT"
                          checked={inspectionResult === "NO_VISIBLE_INCIDENT"}
                          onChange={() => setInspectionResult("NO_VISIBLE_INCIDENT")}
                          className="text-emerald-600 focus:ring-emerald-500"
                        />
                        <div>
                          <span className="text-xs font-semibold text-white block">Sin Novedad Visible</span>
                          <span className="text-[11px] text-slate-400">
                            Vehículo en orden, sin daños o rayones nuevos observados.
                          </span>
                        </div>
                      </label>

                      <label className="flex items-center space-x-3 bg-slate-950 border border-slate-800 p-3 rounded-lg cursor-pointer hover:border-slate-700 transition">
                        <input
                          type="radio"
                          name="result"
                          value="DAMAGE_OBSERVED"
                          checked={inspectionResult === "DAMAGE_OBSERVED"}
                          onChange={() => setInspectionResult("DAMAGE_OBSERVED")}
                          className="text-emerald-600 focus:ring-emerald-500"
                        />
                        <div>
                          <span className="text-xs font-semibold text-amber-400 block">Daño / Raspón Observado</span>
                          <span className="text-[11px] text-slate-400">
                            Se detecta abolladura, raspón, rotura o pintura ajena. Generará folio de incidente.
                          </span>
                        </div>
                      </label>

                      <label className="flex items-center space-x-3 bg-slate-950 border border-slate-800 p-3 rounded-lg cursor-pointer hover:border-slate-700 transition">
                        <input
                          type="radio"
                          name="result"
                          value="UNABLE_TO_COMPLETE"
                          checked={inspectionResult === "UNABLE_TO_COMPLETE"}
                          onChange={() => setInspectionResult("UNABLE_TO_COMPLETE")}
                          className="text-emerald-600 focus:ring-emerald-500"
                        />
                        <div>
                          <span className="text-xs font-semibold text-rose-400 block">No Fue Posible Completar</span>
                          <span className="text-[11px] text-slate-400">
                            Vehículo ausente, espacio bloqueado o impedimento de acceso.
                          </span>
                        </div>
                      </label>
                    </div>
                  </div>

                  {inspectionResult === "DAMAGE_OBSERVED" && (
                    <div className="space-y-3 p-4 bg-amber-950/20 border border-amber-800/60 rounded-xl">
                      <div>
                        <label className="block text-xs font-medium text-amber-300 mb-1">
                          Descripción Detallada del Daño (Obligatorio)
                        </label>
                        <textarea
                          value={damageDesc}
                          onChange={(e) => setDamageDesc(e.target.value)}
                          placeholder="Ej: Raspón en guardabarros delantero izquierdo con restos de pintura blanca..."
                          rows={3}
                          required
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-white focus:outline-none focus:border-amber-500"
                        />
                      </div>

                      <div className="space-y-2 pt-1">
                        <label className="flex items-center space-x-2 text-xs text-slate-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={surveillanceReq}
                            onChange={(e) => setSurveillanceReq(e.target.checked)}
                            className="rounded border-slate-700 bg-slate-950 text-emerald-600 focus:ring-emerald-500"
                          />
                          <span>Solicitar revisión prioritaria de cámaras de seguridad (CCTV)</span>
                        </label>

                        <label className="flex items-center space-x-2 text-xs text-slate-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={ownerContactReq}
                            onChange={(e) => setOwnerContactReq(e.target.checked)}
                            className="rounded border-slate-700 bg-slate-950 text-emerald-600 focus:ring-emerald-500"
                          />
                          <span>Notificar al guarda de portería para contactar al propietario al ingreso/salida</span>
                        </label>
                      </div>
                    </div>
                  )}

                  {inspectionResult === "UNABLE_TO_COMPLETE" && (
                    <div className="p-4 bg-rose-950/20 border border-rose-800/60 rounded-xl space-y-2">
                      <label className="block text-xs font-medium text-rose-300 mb-1">
                        Motivo de Imposibilidad (Obligatorio)
                      </label>
                      <select
                        value={unableReason}
                        onChange={(e) => setUnableReason(e.target.value)}
                        required
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-white focus:outline-none focus:border-rose-500"
                      >
                        <option value="">Seleccione un motivo...</option>
                        <option value="VEHICLE_ABSENT">Vehículo no se encuentra en el espacio asignado</option>
                        <option value="SPACE_BLOCKED">Acceso al espacio bloqueado por obras o vehículos</option>
                        <option value="INSUFFICIENT_LIGHTING">Iluminación insuficiente o falla de visibilidad</option>
                        <option value="SECURITY_EMERGENCY">Ronda interrumpida por novedad de seguridad urgente</option>
                        <option value="OTHER">Otro impedimento justificado</option>
                      </select>
                    </div>
                  )}

                  <div className="flex space-x-3 pt-2">
                    <button
                      type="submit"
                      disabled={!canPerformInspections || inspectionSubmitting}
                      className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs py-2.5 px-4 rounded-lg transition shadow disabled:opacity-50 flex items-center justify-center space-x-2"
                    >
                      {inspectionSubmitting ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Guardando inspección...</span>
                        </>
                      ) : (
                        <span>Registrar Inspección Oficial</span>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => setSelectedTask(null)}
                      disabled={inspectionSubmitting}
                      className="bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs py-2.5 px-4 rounded-lg transition"
                    >
                      Cancelar
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        )}

        {/* TAB 4: INCIDENTES */}
        {activeTab === "incidents" && (
          <div className="space-y-6">
            {!selectedIncident ? (
              /* INCIDENT QUEUE VIEW */
              <div className="space-y-6">
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                    <div>
                      <h2 className="text-base font-semibold text-white flex items-center space-x-2">
                        <AlertTriangle className="w-5 h-5 text-amber-400" />
                        <span>Centro de Control de Incidentes y Expedientes de Daño</span>
                      </h2>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Flujo supervisado: revisión de novedades, investigación de cámaras, contacto con propietarios, resolución y cierre auditable.
                      </p>
                    </div>
                    <button
                      onClick={fetchIncidents}
                      disabled={incidentsLoading}
                      className="self-start sm:self-auto bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs px-3 py-1.5 rounded-lg flex items-center space-x-1.5 transition disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${incidentsLoading ? "animate-spin" : ""}`} />
                      <span>Refrescar</span>
                    </button>
                  </div>

                  {/* Incident Metric Chips */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 mb-5">
                    <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-2.5">
                      <span className="text-[10px] text-slate-400 uppercase font-semibold">Total</span>
                      <p className="text-lg font-bold text-white mt-0.5">{incidents.length}</p>
                    </div>
                    <div className="bg-amber-950/20 border border-amber-900/40 rounded-lg p-2.5">
                      <span className="text-[10px] text-amber-400 uppercase font-semibold">Abiertos / Acción</span>
                      <p className="text-lg font-bold text-amber-300 mt-0.5">
                        {incidents.filter((i) => i.status !== "RESOLVED" && i.status !== "CLOSED").length}
                      </p>
                    </div>
                    <div className="bg-blue-950/20 border border-blue-900/40 rounded-lg p-2.5">
                      <span className="text-[10px] text-blue-400 uppercase font-semibold">En Investigación</span>
                      <p className="text-lg font-bold text-blue-300 mt-0.5">
                        {incidents.filter((i) => i.status === "UNDER_INVESTIGATION").length}
                      </p>
                    </div>
                    <div className="bg-purple-950/20 border border-purple-900/40 rounded-lg p-2.5">
                      <span className="text-[10px] text-purple-400 uppercase font-semibold">Contacto Pendiente</span>
                      <p className="text-lg font-bold text-purple-300 mt-0.5">
                        {incidents.filter((i) => i.status === "OWNER_CONTACT_PENDING").length}
                      </p>
                    </div>
                    <div className="bg-emerald-950/20 border border-emerald-900/40 rounded-lg p-2.5">
                      <span className="text-[10px] text-emerald-400 uppercase font-semibold">Resueltos</span>
                      <p className="text-lg font-bold text-emerald-300 mt-0.5">
                        {incidents.filter((i) => i.status === "RESOLVED").length}
                      </p>
                    </div>
                    <div className="bg-slate-950/40 border border-slate-800 rounded-lg p-2.5">
                      <span className="text-[10px] text-slate-400 uppercase font-semibold">Cerrados</span>
                      <p className="text-lg font-bold text-slate-300 mt-0.5">
                        {incidents.filter((i) => i.status === "CLOSED").length}
                      </p>
                    </div>
                  </div>

                  {/* Filters & Search Controls */}
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 mb-4 bg-slate-950/60 p-3 rounded-lg border border-slate-800/80">
                    <div className="relative flex-1">
                      <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="text"
                        value={incidentSearch}
                        onChange={(e) => setIncidentSearch(e.target.value)}
                        placeholder="Buscar por placa de vehículo o ID de incidente..."
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 font-mono"
                      />
                    </div>
                    <div className="flex items-center space-x-2">
                      <Filter className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                      <select
                        value={incidentStatusFilter}
                        onChange={(e) => setIncidentStatusFilter(e.target.value)}
                        className="bg-slate-900 border border-slate-800 text-slate-200 text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-emerald-500"
                      >
                        <option value="ALL">Todos los Estados</option>
                        <option value="UNRESOLVED">Pendientes / Requieren Acción</option>
                        <option value="REPORTED">REPORTED (Reportados)</option>
                        <option value="AWAITING_REVIEW">AWAITING_REVIEW (En Revisión)</option>
                        <option value="UNDER_INVESTIGATION">UNDER_INVESTIGATION (En Investigación)</option>
                        <option value="OWNER_CONTACT_PENDING">OWNER_CONTACT_PENDING (Contacto Pendiente)</option>
                        <option value="OWNER_CONTACTED">OWNER_CONTACTED (Propietario Contactado)</option>
                        <option value="RESOLVED">RESOLVED (Resueltos)</option>
                        <option value="CLOSED">CLOSED (Cerrados)</option>
                      </select>
                    </div>
                  </div>

                  {/* Error & Loading States */}
                  {incidentsError && (
                    <div className="mb-4 p-3 rounded-lg bg-rose-950/80 border border-rose-800 text-rose-300 text-xs flex items-center space-x-2">
                      <XCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
                      <span>{incidentsError}</span>
                    </div>
                  )}

                  {incidentsLoading ? (
                    <div className="py-12 text-center text-slate-500 text-xs flex flex-col items-center justify-center space-y-2">
                      <Loader2 className="w-6 h-6 animate-spin text-emerald-400" />
                      <span>Cargando incidentes del servidor...</span>
                    </div>
                  ) : (
                    (() => {
                      const filtered = incidents.filter((inc) => {
                        // Filter by status
                        if (incidentStatusFilter === "UNRESOLVED") {
                          if (inc.status === "RESOLVED" || inc.status === "CLOSED") return false;
                        } else if (incidentStatusFilter !== "ALL") {
                          if (inc.status !== incidentStatusFilter) return false;
                        }
                        // Filter by search query
                        if (incidentSearch.trim()) {
                          const query = incidentSearch.trim().toUpperCase();
                          const matchesPlate = inc.vehicle?.plate?.toUpperCase().includes(query);
                          const matchesId = inc.id?.toUpperCase().includes(query);
                          if (!matchesPlate && !matchesId) return false;
                        }
                        return true;
                      });

                      if (filtered.length === 0) {
                        return (
                          <div className="py-12 text-center bg-slate-950/50 rounded-xl border border-slate-800/60 p-6">
                            <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2 opacity-80" />
                            <p className="text-sm font-medium text-white">No hay incidentes para los filtros seleccionados</p>
                            <p className="text-xs text-slate-400 mt-1">
                              {incidents.length === 0
                                ? "Los incidentes se generan automáticamente cuando un rondero reporta daños en una inspección."
                                : "Modifique los filtros o el término de búsqueda para ver más expedientes."}
                            </p>
                          </div>
                        );
                      }

                      return (
                        <div className="space-y-3">
                          {filtered.map((inc) => {
                            const latestFollowUp = inc.followUps && inc.followUps.length > 0 ? inc.followUps[0] : null;

                            return (
                              <div
                                key={inc.id}
                                className="bg-slate-950 border border-slate-800/90 hover:border-slate-700/80 rounded-xl p-4 space-y-3 transition"
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-2.5">
                                  <div className="flex items-center space-x-3">
                                    <span className="font-mono text-xs text-slate-400">#{inc.id.slice(0, 8)}</span>
                                    <span className="font-mono font-bold text-white text-base bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                                      {inc.vehicle?.plate}
                                    </span>
                                    <span className="text-xs text-slate-400">
                                      {inc.vehicle?.parkingSpace || "Sin espacio asignado"}
                                    </span>
                                  </div>
                                  <div className="flex items-center space-x-2">
                                    <IncidentStatusBadge status={inc.status} size="sm" />
                                    <button
                                      onClick={() => {
                                        setSelectedIncident(inc);
                                        setIncidentActionType(null);
                                        setIncidentActionMsg(null);
                                        setIncidentActionErr(null);
                                      }}
                                      className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs px-2.5 py-1 rounded flex items-center space-x-1 transition font-medium"
                                    >
                                      <Eye className="w-3.5 h-3.5" />
                                      <span>Ver Expediente</span>
                                    </button>
                                  </div>
                                </div>

                                <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/50">
                                  <p className="text-xs text-slate-200 leading-relaxed font-sans">
                                    &ldquo;{inc.description}&rdquo;
                                  </p>
                                </div>

                                <div className="flex flex-wrap items-center justify-between text-[11px] text-slate-400 pt-1">
                                  <span>
                                    Reportado por: <strong className="text-slate-300">{inc.reportedBy?.name || "Guardia"}</strong>
                                  </span>
                                  <span>{new Date(inc.observedAt).toLocaleString()}</span>
                                </div>

                                {/* Flags & Surveillance / Contact summary */}
                                <div className="flex flex-wrap gap-2 pt-0.5">
                                  {inc.surveillanceRequired && (
                                    <span className="text-[10px] bg-purple-950/80 text-purple-300 border border-purple-800 px-2 py-0.5 rounded-full flex items-center space-x-1">
                                      <Camera className="w-3 h-3" />
                                      <span>CCTV Solicitado</span>
                                    </span>
                                  )}
                                  {inc.ownerContactRequired && (
                                    <span className="text-[10px] bg-blue-950/80 text-blue-300 border border-blue-800 px-2 py-0.5 rounded-full flex items-center space-x-1">
                                      <Phone className="w-3 h-3" />
                                      <span>Contacto Propietario</span>
                                    </span>
                                  )}
                                  {inc.surveillanceOutcome && (
                                    <span className="text-[10px] bg-slate-900 text-slate-300 border border-slate-700 px-2 py-0.5 rounded-full">
                                      CCTV: {inc.surveillanceOutcome.slice(0, 40)}...
                                    </span>
                                  )}
                                  {inc.ownerContactedAt && (
                                    <span className="text-[10px] bg-cyan-950/80 text-cyan-300 border border-cyan-800 px-2 py-0.5 rounded-full">
                                      Propietario Contactado ({new Date(inc.ownerContactedAt).toLocaleDateString()})
                                    </span>
                                  )}
                                </div>

                                {/* Latest Follow-Up Audit Preview */}
                                {latestFollowUp && (
                                  <div className="text-[11px] bg-slate-900/80 p-2 rounded border border-slate-800/80 text-slate-300 flex items-start space-x-2">
                                    <Clock className="w-3.5 h-3.5 text-slate-400 mt-0.5 flex-shrink-0" />
                                    <div className="flex-1">
                                      <span className="text-slate-400">Último seguimiento: </span>
                                      <span>{latestFollowUp.description}</span>
                                      <span className="text-slate-500 text-[10px] ml-1">
                                        ({new Date(latestFollowUp.performedAt).toLocaleTimeString()})
                                      </span>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()
                  )}
                </div>
              </div>
            ) : (
              /* INCIDENT DETAIL & SUPERVISOR WORKFLOW VIEW */
              <div className="space-y-6">
                {/* Detail View Header */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
                    <div className="flex items-center space-x-3">
                      <button
                        onClick={() => {
                          setSelectedIncident(null);
                          setIncidentActionType(null);
                          setIncidentActionMsg(null);
                          setIncidentActionErr(null);
                        }}
                        className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs px-3 py-1.5 rounded-lg flex items-center space-x-1.5 transition"
                      >
                        <ChevronLeft className="w-4 h-4" />
                        <span>Volver a la Lista</span>
                      </button>
                      <span className="font-mono font-bold text-white text-lg bg-slate-950 px-2.5 py-1 rounded border border-slate-800">
                        {selectedIncident.vehicle?.plate}
                      </span>
                      <span className="text-xs text-slate-400">
                        {selectedIncident.vehicle?.parkingSpace || "Sin espacio asignado"}
                      </span>
                    </div>

                    <div className="flex items-center space-x-2">
                      <IncidentStatusBadge status={selectedIncident.status} size="md" />
                      <button
                        onClick={fetchIncidents}
                        disabled={incidentsLoading}
                        className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs p-1.5 rounded-lg transition disabled:opacity-50"
                        title="Refrescar expediente"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${incidentsLoading ? "animate-spin" : ""}`} />
                      </button>
                    </div>
                  </div>

                  {/* Feedback Alerts */}
                  {incidentActionMsg && (
                    <div className="mt-4 p-3 rounded-lg bg-emerald-950/80 border border-emerald-800 text-emerald-300 text-xs flex items-center space-x-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                      <span>{incidentActionMsg}</span>
                    </div>
                  )}

                  {incidentActionErr && (
                    <div className="mt-4 p-3 rounded-lg bg-rose-950/80 border border-rose-800 text-rose-300 text-xs flex items-center space-x-2">
                      <XCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
                      <span>{incidentActionErr}</span>
                    </div>
                  )}

                  {/* Two-Column Dossier Grid */}
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mt-5">
                    {/* LEFT COLUMN: Original Observation, Attachments & Audit Follow-ups */}
                    <div className="lg:col-span-7 space-y-5">
                      {/* Original Observation Card */}
                      <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3">
                        <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
                          <h3 className="text-xs font-semibold text-slate-300 flex items-center space-x-1.5 uppercase tracking-wide">
                            <AlertCircle className="w-4 h-4 text-amber-400" />
                            <span>Observación Original Registrada</span>
                          </h3>
                          <span className="font-mono text-[11px] text-slate-500">
                            ID: #{selectedIncident.id}
                          </span>
                        </div>

                        <div className="bg-slate-900/80 p-3 rounded-lg border border-slate-800 text-slate-100 text-xs leading-relaxed font-sans">
                          {selectedIncident.description}
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-slate-400 pt-1">
                          <div>
                            <span className="text-slate-500">Reportado por: </span>
                            <strong className="text-slate-300">{selectedIncident.reportedBy?.name}</strong>
                            <p className="text-[10px] text-slate-500">{selectedIncident.reportedBy?.email}</p>
                          </div>
                          <div>
                            <span className="text-slate-500">Fecha y Hora Observación: </span>
                            <p className="text-slate-300">{new Date(selectedIncident.observedAt).toLocaleString()}</p>
                          </div>
                        </div>

                        {/* Flags */}
                        <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-800/80">
                          {selectedIncident.surveillanceRequired ? (
                            <span className="text-[11px] bg-purple-950/80 text-purple-300 border border-purple-800 px-2 py-0.5 rounded-full flex items-center space-x-1">
                              <Camera className="w-3 h-3" />
                              <span>Requiere Revisión de Cámaras</span>
                            </span>
                          ) : (
                            <span className="text-[11px] text-slate-500 bg-slate-900 px-2 py-0.5 rounded-full">
                              No requiere cámaras
                            </span>
                          )}
                          {selectedIncident.ownerContactRequired ? (
                            <span className="text-[11px] bg-blue-950/80 text-blue-300 border border-blue-800 px-2 py-0.5 rounded-full flex items-center space-x-1">
                              <Phone className="w-3 h-3" />
                              <span>Requiere Contacto con Propietario</span>
                            </span>
                          ) : (
                            <span className="text-[11px] text-slate-500 bg-slate-900 px-2 py-0.5 rounded-full">
                              No requiere contacto
                            </span>
                          )}
                        </div>

                        {/* CCTV Outcome Box if recorded */}
                        {selectedIncident.surveillanceOutcome && (
                          <div className="bg-purple-950/30 border border-purple-900/60 p-2.5 rounded-lg text-xs">
                            <span className="font-semibold text-purple-300 block mb-1">
                              Hallazgo de Revisión CCTV:
                            </span>
                            <p className="text-purple-200">{selectedIncident.surveillanceOutcome}</p>
                          </div>
                        )}

                        {/* Owner Contact Box if recorded */}
                        {selectedIncident.ownerContactNotes && (
                          <div className="bg-blue-950/30 border border-blue-900/60 p-2.5 rounded-lg text-xs">
                            <div className="flex justify-between items-center mb-1">
                              <span className="font-semibold text-blue-300">
                                Registro de Contacto con Propietario:
                              </span>
                              {selectedIncident.ownerContactedAt && (
                                <span className="text-[10px] text-blue-400">
                                  {new Date(selectedIncident.ownerContactedAt).toLocaleString()}
                                </span>
                              )}
                            </div>
                            <p className="text-blue-200">{selectedIncident.ownerContactNotes}</p>
                          </div>
                        )}

                        {/* Resolution details if resolved */}
                        {selectedIncident.resolutionNotes && (
                          <div className="bg-emerald-950/40 border border-emerald-900/60 p-2.5 rounded-lg text-xs">
                            <div className="flex justify-between items-center mb-1">
                              <span className="font-semibold text-emerald-300">
                                Dictamen Final de Resolución:
                              </span>
                              {selectedIncident.resolvedAt && (
                                <span className="text-[10px] text-emerald-400">
                                  {new Date(selectedIncident.resolvedAt).toLocaleString()}
                                </span>
                              )}
                            </div>
                            <p className="text-emerald-200">{selectedIncident.resolutionNotes}</p>
                          </div>
                        )}
                      </div>

                      {/* Attachments Section */}
                      <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3">
                        <h3 className="text-xs font-semibold text-slate-300 flex items-center space-x-1.5 uppercase tracking-wide">
                          <FileText className="w-4 h-4 text-blue-400" />
                          <span>Evidencias y Adjuntos Oficiales ({selectedIncident.attachments?.length || 0})</span>
                        </h3>

                        {!selectedIncident.attachments || selectedIncident.attachments.length === 0 ? (
                          <p className="text-xs text-slate-500 italic">
                            Sin fotografías ni documentos adjuntos registrados para este incidente.
                          </p>
                        ) : (
                          <div className="space-y-2">
                            {selectedIncident.attachments.map((att) => (
                              <div
                                key={att.id}
                                className="bg-slate-900 p-2 rounded-lg border border-slate-800 flex items-center justify-between text-xs"
                              >
                                <div>
                                  <span className="font-mono text-slate-200 block">{att.originalName}</span>
                                  <span className="text-[10px] text-slate-400">
                                    {(att.fileSize / 1024).toFixed(1)} KB • {att.attachmentType} • {new Date(att.uploadedAt).toLocaleDateString()}
                                  </span>
                                </div>
                                <span className="text-[10px] font-mono text-slate-500 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                                  {att.mimeType}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Chronological Audit Trail Timeline */}
                      <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3">
                        <h3 className="text-xs font-semibold text-slate-300 flex items-center space-x-1.5 uppercase tracking-wide">
                          <Clock className="w-4 h-4 text-emerald-400" />
                          <span>Bitácora Cronológica de Auditoría y Seguimiento ({selectedIncident.followUps?.length || 0})</span>
                        </h3>

                        {!selectedIncident.followUps || selectedIncident.followUps.length === 0 ? (
                          <p className="text-xs text-slate-500 italic">
                            Sin registros de seguimiento adicionales aún.
                          </p>
                        ) : (
                          <div className="space-y-3 relative before:absolute before:inset-0 before:left-3.5 before:w-0.5 before:bg-slate-800">
                            {selectedIncident.followUps.map((fup) => (
                              <div key={fup.id} className="relative flex items-start space-x-3 pl-1">
                                <div className="w-6 h-6 rounded-full bg-slate-900 border border-slate-700 flex items-center justify-center text-[10px] font-bold text-slate-300 z-10 flex-shrink-0">
                                  {fup.actionType === "STATUS_CHANGE"
                                    ? "ST"
                                    : fup.actionType === "SURVEILLANCE_REVIEW"
                                    ? "CCTV"
                                    : fup.actionType === "OWNER_CONTACT_ATTEMPT"
                                    ? "OC"
                                    : fup.actionType === "RESOLUTION"
                                    ? "RES"
                                    : "NT"}
                                </div>
                                <div className="flex-1 bg-slate-900/90 border border-slate-800/80 rounded-lg p-2.5 space-y-1">
                                  <div className="flex flex-wrap items-center justify-between text-[11px] gap-1">
                                    <span className="font-semibold text-slate-200">
                                      {fup.performedBy?.name || "Funcionario Autorizado"}
                                    </span>
                                    <span className="text-slate-500 text-[10px]">
                                      {new Date(fup.performedAt).toLocaleString()}
                                    </span>
                                  </div>
                                  <p className="text-xs text-slate-300 leading-relaxed font-sans">
                                    {fup.description}
                                  </p>
                                  {fup.outcome && (
                                    <span className="inline-block text-[10px] bg-slate-950 text-slate-400 border border-slate-800 px-1.5 py-0.5 rounded font-mono">
                                      Resultado: {fup.outcome}
                                    </span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* RIGHT COLUMN: Supervisor Action Center & Workflow State Machine */}
                    <div className="lg:col-span-5 space-y-5">
                      {canManageIncidents ? (
                        <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-4">
                          <div className="border-b border-slate-800/80 pb-2">
                            <h3 className="text-xs font-semibold text-white flex items-center space-x-1.5 uppercase tracking-wide">
                              <ShieldCheck className="w-4 h-4 text-emerald-400" />
                              <span>Panel de Control de Supervisor</span>
                            </h3>
                            <p className="text-[11px] text-slate-400 mt-0.5">
                              Gestione el ciclo de vida, documente hallazgos y tome decisiones auditables.
                            </p>
                          </div>

                          {selectedIncident.status === "CLOSED" ? (
                            <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-4 text-center space-y-2">
                              <CheckCircle2 className="w-8 h-8 text-slate-400 mx-auto opacity-70" />
                              <p className="text-sm font-semibold text-white">Expediente Cerrado y Archivado</p>
                              <p className="text-xs text-slate-400">
                                Este incidente ha concluido su ciclo de vida formal. De acuerdo con las normas de auditoría, los registros cerrados son inmutables.
                              </p>
                            </div>
                          ) : (
                            <div className="space-y-4">
                              {/* Action Selector Buttons */}
                              <div className="grid grid-cols-2 gap-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setIncidentActionType("NOTE");
                                    setIncidentActionErr(null);
                                    setIncidentActionMsg(null);
                                  }}
                                  className={`p-2.5 rounded-lg text-xs font-medium border flex items-center space-x-2 transition ${
                                    incidentActionType === "NOTE"
                                      ? "bg-slate-800 border-emerald-500 text-white"
                                      : "bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-850"
                                  }`}
                                >
                                  <FileText className="w-3.5 h-3.5 text-blue-400" />
                                  <span>Nota Investigación</span>
                                </button>

                                <button
                                  type="button"
                                  onClick={() => {
                                    setIncidentActionType("SURVEILLANCE");
                                    setIncidentActionErr(null);
                                    setIncidentActionMsg(null);
                                  }}
                                  className={`p-2.5 rounded-lg text-xs font-medium border flex items-center space-x-2 transition ${
                                    incidentActionType === "SURVEILLANCE"
                                      ? "bg-slate-800 border-emerald-500 text-white"
                                      : "bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-850"
                                  }`}
                                >
                                  <Camera className="w-3.5 h-3.5 text-purple-400" />
                                  <span>Revisión CCTV</span>
                                </button>

                                <button
                                  type="button"
                                  disabled={selectedIncident.status === "REPORTED"}
                                  title={
                                    selectedIncident.status === "REPORTED"
                                      ? "El contacto con propietario no está permitido directamente en estado REPORTADO. Pase primero a En Revisión o En Investigación."
                                      : ""
                                  }
                                  onClick={() => {
                                    setIncidentActionType("OWNER_CONTACT");
                                    setIncidentActionErr(null);
                                    setIncidentActionMsg(null);
                                  }}
                                  className={`p-2.5 rounded-lg text-xs font-medium border flex items-center space-x-2 transition ${
                                    selectedIncident.status === "REPORTED"
                                      ? "opacity-40 cursor-not-allowed bg-slate-900 border-slate-800 text-slate-500"
                                      : incidentActionType === "OWNER_CONTACT"
                                      ? "bg-slate-800 border-emerald-500 text-white"
                                      : "bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-850"
                                  }`}
                                >
                                  <Phone className="w-3.5 h-3.5 text-cyan-400" />
                                  <span>Contacto Propietario</span>
                                </button>

                                <button
                                  type="button"
                                  onClick={() => {
                                    setIncidentActionType("STATUS_TRANSITION");
                                    setIncidentActionErr(null);
                                    setIncidentActionMsg(null);
                                    const permitted = getPermittedTransitions(selectedIncident.status);
                                    if (permitted.length > 0) {
                                      setTargetStatus(permitted[0].status);
                                    }
                                  }}
                                  className={`p-2.5 rounded-lg text-xs font-medium border flex items-center space-x-2 transition ${
                                    incidentActionType === "STATUS_TRANSITION"
                                      ? "bg-slate-800 border-emerald-500 text-white"
                                      : "bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-850"
                                  }`}
                                >
                                  <ArrowRight className="w-3.5 h-3.5 text-amber-400" />
                                  <span>Avanzar Estado</span>
                                </button>

                                {getPermittedTransitions(selectedIncident.status).some((t) => t.status === "RESOLVED") && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setIncidentActionType("RESOLVE");
                                      setIncidentActionErr(null);
                                      setIncidentActionMsg(null);
                                    }}
                                    className={`col-span-2 p-2.5 rounded-lg text-xs font-medium border flex items-center justify-center space-x-2 transition ${
                                      incidentActionType === "RESOLVE"
                                        ? "bg-emerald-950 border-emerald-500 text-emerald-200"
                                        : "bg-emerald-950/30 border-emerald-900/60 text-emerald-300 hover:bg-emerald-950/50"
                                    }`}
                                  >
                                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                                    <span>Resolver Incidente</span>
                                  </button>
                                )}

                                {selectedIncident.status === "RESOLVED" && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setIncidentActionType("CLOSE");
                                      setIncidentActionErr(null);
                                      setIncidentActionMsg(null);
                                    }}
                                    className={`col-span-2 p-2.5 rounded-lg text-xs font-medium border flex items-center justify-center space-x-2 transition ${
                                      incidentActionType === "CLOSE"
                                        ? "bg-rose-950 border-rose-500 text-rose-200"
                                        : "bg-rose-950/30 border-rose-900/60 text-rose-300 hover:bg-rose-950/50"
                                    }`}
                                  >
                                    <Check className="w-3.5 h-3.5 text-rose-400" />
                                    <span>Cerrar y Archivar Expediente</span>
                                  </button>
                                )}
                              </div>

                              {/* Form: Investigation Note */}
                              {incidentActionType === "NOTE" && (
                                <div className="bg-slate-900 p-3 rounded-lg border border-slate-800 space-y-3">
                                  <h4 className="text-xs font-semibold text-slate-200 flex items-center space-x-1.5">
                                    <FileText className="w-3.5 h-3.5 text-blue-400" />
                                    <span>Registrar Nota de Investigación</span>
                                  </h4>
                                  <div>
                                    <label className="block text-[11px] text-slate-400 mb-1" htmlFor="action-note">
                                      Hallazgos u observaciones del supervisor *
                                    </label>
                                    <textarea
                                      id="action-note"
                                      rows={3}
                                      value={actionNotes}
                                      onChange={(e) => setActionNotes(e.target.value)}
                                      placeholder="Detalle los hallazgos de la inspección, entrevistas al personal o avances de la indagación..."
                                      className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-[11px] text-slate-400 mb-1" htmlFor="next-action-note">
                                      Próxima acción requerida (opcional)
                                    </label>
                                    <input
                                      id="next-action-note"
                                      type="text"
                                      value={contactNextAction}
                                      onChange={(e) => setContactNextAction(e.target.value)}
                                      placeholder="Ej: Citar al propietario para revisión presencial"
                                      className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                                    />
                                  </div>
                                  <div className="flex justify-end space-x-2 pt-1">
                                    <button
                                      type="button"
                                      onClick={() => setIncidentActionType(null)}
                                      className="bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs px-3 py-1.5 rounded transition"
                                    >
                                      Cancelar
                                    </button>
                                    <button
                                      type="button"
                                      onClick={handleExecuteIncidentAction}
                                      disabled={incidentSubmitting || !actionNotes.trim()}
                                      className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs px-3 py-1.5 rounded font-medium transition flex items-center space-x-1"
                                    >
                                      {incidentSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                      <span>Guardar Nota</span>
                                    </button>
                                  </div>
                                </div>
                              )}

                              {/* Form: CCTV Review */}
                              {incidentActionType === "SURVEILLANCE" && (
                                <div className="bg-slate-900 p-3 rounded-lg border border-slate-800 space-y-3">
                                  <h4 className="text-xs font-semibold text-slate-200 flex items-center space-x-1.5">
                                    <Camera className="w-3.5 h-3.5 text-purple-400" />
                                    <span>Registrar Revisión de Cámaras de Seguridad</span>
                                  </h4>
                                  <div>
                                    <label className="block text-[11px] text-slate-400 mb-1" htmlFor="cctv-outcome">
                                      Dictamen o conclusión del video *
                                    </label>
                                    <select
                                      id="cctv-outcome"
                                      value={cctvOutcome}
                                      onChange={(e) => setCctvOutcome(e.target.value)}
                                      className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-xs text-white focus:outline-none focus:border-emerald-500 mb-2"
                                    >
                                      <option value="">-- Seleccione una conclusión o escriba abajo --</option>
                                      <option value="Vehículo ingresó al conjunto residencial con daño preexistente verificado en cámara">
                                        Vehículo ingresó con daño preexistente (verificado en portería)
                                      </option>
                                      <option value="Daño ocasionado por maniobra de estacionamiento dentro de la copropiedad">
                                        Daño ocasionado por maniobra dentro del parqueadero
                                      </option>
                                      <option value="Grabaciones no concluyentes por ángulo o punto ciego">
                                        Grabaciones no concluyentes / punto ciego
                                      </option>
                                      <option value="Sin novedad en el lapso temporal auditado">
                                        Sin novedad en lapso temporal auditado
                                      </option>
                                    </select>
                                    <input
                                      type="text"
                                      value={cctvOutcome}
                                      onChange={(e) => setCctvOutcome(e.target.value)}
                                      placeholder="O escriba conclusión personalizada del supervisor..."
                                      className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-[11px] text-slate-400 mb-1" htmlFor="cctv-obs">
                                      Cámaras revisadas y observaciones técnicas
                                    </label>
                                    <textarea
                                      id="cctv-obs"
                                      rows={2}
                                      value={cctvObservations}
                                      onChange={(e) => setCctvObservations(e.target.value)}
                                      placeholder="Ej: Cámara PTZ Acceso Principal, minutero 14:22 a 14:35..."
                                      className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                                    />
                                  </div>
                                  {(selectedIncident.status === "REPORTED" || selectedIncident.status === "AWAITING_REVIEW") && (
                                    <label className="flex items-center space-x-2 text-xs text-slate-300 cursor-pointer pt-1">
                                      <input
                                        type="checkbox"
                                        checked={cctvAdvanceStatus}
                                        onChange={(e) => setCctvAdvanceStatus(e.target.checked)}
                                        className="rounded border-slate-700 text-emerald-600 focus:ring-0"
                                      />
                                      <span>Avanzar estado a &ldquo;En Investigación&rdquo;</span>
                                    </label>
                                  )}
                                  <div className="flex justify-end space-x-2 pt-1">
                                    <button
                                      type="button"
                                      onClick={() => setIncidentActionType(null)}
                                      className="bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs px-3 py-1.5 rounded transition"
                                    >
                                      Cancelar
                                    </button>
                                    <button
                                      type="button"
                                      onClick={handleExecuteIncidentAction}
                                      disabled={incidentSubmitting || !cctvOutcome.trim()}
                                      className="bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-xs px-3 py-1.5 rounded font-medium transition flex items-center space-x-1"
                                    >
                                      {incidentSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                      <span>Registrar Revisión CCTV</span>
                                    </button>
                                  </div>
                                </div>
                              )}

                              {/* Form: Owner Contact */}
                              {incidentActionType === "OWNER_CONTACT" && (
                                <div className="bg-slate-900 p-3 rounded-lg border border-slate-800 space-y-3">
                                  <h4 className="text-xs font-semibold text-slate-200 flex items-center space-x-1.5">
                                    <Phone className="w-3.5 h-3.5 text-cyan-400" />
                                    <span>Registrar Gestión de Contacto con Propietario</span>
                                  </h4>
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    <div>
                                      <label className="block text-[11px] text-slate-400 mb-1" htmlFor="contact-method">
                                        Medio de Contacto *
                                      </label>
                                      <select
                                        id="contact-method"
                                        value={contactMethod}
                                        onChange={(e) => setContactMethod(e.target.value)}
                                        className="w-full bg-slate-950 border border-slate-800 rounded p-1.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                                      >
                                        <option value="INTERCOM">Citófono / Intercomunicador</option>
                                        <option value="PHONE">Llamada Telefónica / Celular</option>
                                        <option value="IN_PERSON">Presencial en Portería</option>
                                        <option value="WRITTEN_NOTICE">Notificación Escrita / Minuta</option>
                                        <option value="EMAIL">Correo Electrónico Registrado</option>
                                      </select>
                                    </div>
                                    <div>
                                      <label className="block text-[11px] text-slate-400 mb-1">
                                        Resultado del Intento *
                                      </label>
                                      <div className="flex items-center space-x-3 pt-1">
                                        <label className="flex items-center space-x-1.5 text-xs text-slate-200 cursor-pointer">
                                          <input
                                            type="radio"
                                            name="contactSuccess"
                                            checked={contactSuccessful}
                                            onChange={() => setContactSuccessful(true)}
                                            className="text-emerald-600 focus:ring-0"
                                          />
                                          <span>Exitoso</span>
                                        </label>
                                        <label className="flex items-center space-x-1.5 text-xs text-slate-200 cursor-pointer">
                                          <input
                                            type="radio"
                                            name="contactSuccess"
                                            checked={!contactSuccessful}
                                            onChange={() => setContactSuccessful(false)}
                                            className="text-emerald-600 focus:ring-0"
                                          />
                                          <span>Pendiente / Reintento</span>
                                        </label>
                                      </div>
                                    </div>
                                  </div>

                                  <div>
                                    <label className="block text-[11px] text-slate-400 mb-1" htmlFor="contact-notes">
                                      Respuesta o descargos del propietario *
                                    </label>
                                    <textarea
                                      id="contact-notes"
                                      rows={2}
                                      value={actionNotes}
                                      onChange={(e) => setActionNotes(e.target.value)}
                                      placeholder="Describa la respuesta obtenida del dueño del vehículo o motivo de no contacto..."
                                      className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                                    />
                                  </div>

                                  <div>
                                    <label className="block text-[11px] text-slate-400 mb-1" htmlFor="contact-next-action">
                                      Próxima acción o acuerdo establecido (opcional)
                                    </label>
                                    <input
                                      id="contact-next-action"
                                      type="text"
                                      value={contactNextAction}
                                      onChange={(e) => setContactNextAction(e.target.value)}
                                      placeholder="Ej: Acuerdan revisar fotos de ingreso mañana a las 09:00"
                                      className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                                    />
                                  </div>

                                  <div className="bg-slate-950 p-2 rounded text-[10px] text-slate-400 border border-slate-800">
                                    {contactSuccessful ? (
                                      <span>El incidente pasará automáticamente a estado <strong>OWNER_CONTACTED</strong>.</span>
                                    ) : (
                                      <span>El incidente pasará automáticamente a estado <strong>OWNER_CONTACT_PENDING</strong>.</span>
                                    )}
                                  </div>

                                  <div className="flex justify-end space-x-2 pt-1">
                                    <button
                                      type="button"
                                      onClick={() => setIncidentActionType(null)}
                                      className="bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs px-3 py-1.5 rounded transition"
                                    >
                                      Cancelar
                                    </button>
                                    <button
                                      type="button"
                                      onClick={handleExecuteIncidentAction}
                                      disabled={incidentSubmitting || !actionNotes.trim()}
                                      className="bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-xs px-3 py-1.5 rounded font-medium transition flex items-center space-x-1"
                                    >
                                      {incidentSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                      <span>Registrar Contacto</span>
                                    </button>
                                  </div>
                                </div>
                              )}

                              {/* Form: Status Transition */}
                              {incidentActionType === "STATUS_TRANSITION" && (
                                <div className="bg-slate-900 p-3 rounded-lg border border-slate-800 space-y-3">
                                  <h4 className="text-xs font-semibold text-slate-200 flex items-center space-x-1.5">
                                    <ArrowRight className="w-3.5 h-3.5 text-amber-400" />
                                    <span>Transición de Estado del Ciclo de Vida</span>
                                  </h4>
                                  <div>
                                    <label className="block text-[11px] text-slate-400 mb-1" htmlFor="target-status">
                                      Nuevo Estado Permitido *
                                    </label>
                                    {(() => {
                                      const permitted = getPermittedTransitions(selectedIncident.status);
                                      if (permitted.length === 0) {
                                        return (
                                          <p className="text-xs text-slate-400 italic">
                                            No hay transiciones directas permitidas para el estado actual.
                                          </p>
                                        );
                                      }
                                      return (
                                        <select
                                          id="target-status"
                                          value={targetStatus}
                                          onChange={(e) => setTargetStatus(e.target.value)}
                                          className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                                        >
                                          {permitted.map((p) => (
                                            <option key={p.status} value={p.status}>
                                              {p.label}
                                            </option>
                                          ))}
                                        </select>
                                      );
                                    })()}
                                  </div>

                                  <div>
                                    <label className="block text-[11px] text-slate-400 mb-1" htmlFor="transition-notes">
                                      Justificación de la transición (requerida para auditoría) *
                                    </label>
                                    <textarea
                                      id="transition-notes"
                                      rows={2}
                                      value={actionNotes}
                                      onChange={(e) => setActionNotes(e.target.value)}
                                      placeholder="Explique el motivo del cambio de estado..."
                                      className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                                    />
                                  </div>

                                  <div className="flex justify-end space-x-2 pt-1">
                                    <button
                                      type="button"
                                      onClick={() => setIncidentActionType(null)}
                                      className="bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs px-3 py-1.5 rounded transition"
                                    >
                                      Cancelar
                                    </button>
                                    <button
                                      type="button"
                                      onClick={handleExecuteIncidentAction}
                                      disabled={incidentSubmitting || !targetStatus}
                                      className="bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-xs px-3 py-1.5 rounded font-medium transition flex items-center space-x-1"
                                    >
                                      {incidentSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                      <span>Aplicar Transición</span>
                                    </button>
                                  </div>
                                </div>
                              )}

                              {/* Form: Resolve Incident */}
                              {incidentActionType === "RESOLVE" && getPermittedTransitions(selectedIncident.status).some((t) => t.status === "RESOLVED") && (
                                <div className="bg-emerald-950/40 p-3.5 rounded-lg border border-emerald-800 space-y-3">
                                  <h4 className="text-xs font-semibold text-emerald-300 flex items-center space-x-1.5">
                                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                                    <span>Resolución Formal del Incidente</span>
                                  </h4>
                                  <p className="text-[11px] text-slate-300">
                                    Para marcar el incidente como <strong>RESUELTO</strong>, debe documentar el dictamen final sobre la responsabilidad o acuerdo alcanzado.
                                  </p>

                                  <div>
                                    <label className="block text-[11px] text-slate-300 mb-1" htmlFor="resolve-notes">
                                      Notas de Resolución y Dictamen Final *
                                    </label>
                                    <textarea
                                      id="resolve-notes"
                                      rows={3}
                                      value={actionNotes}
                                      onChange={(e) => setActionNotes(e.target.value)}
                                      placeholder="Detalle la resolución: ej. Daño preexistente confirmado; o Propietario reconoció maniobra; o Copropiedad asume reparación..."
                                      className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                                    />
                                  </div>

                                  <div className="flex justify-end space-x-2 pt-1">
                                    <button
                                      type="button"
                                      onClick={() => setIncidentActionType(null)}
                                      className="bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs px-3 py-1.5 rounded transition"
                                    >
                                      Cancelar
                                    </button>
                                    <button
                                      type="button"
                                      onClick={handleExecuteIncidentAction}
                                      disabled={incidentSubmitting || !actionNotes.trim()}
                                      className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs px-3 py-1.5 rounded font-medium transition flex items-center space-x-1"
                                    >
                                      {incidentSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                      <span>Confirmar Dictamen y Resolver</span>
                                    </button>
                                  </div>
                                </div>
                              )}

                              {/* Form: Close and Archive Incident */}
                              {incidentActionType === "CLOSE" && (
                                <div className="bg-rose-950/40 p-3.5 rounded-lg border border-rose-800 space-y-3">
                                  <h4 className="text-xs font-semibold text-rose-300 flex items-center space-x-1.5">
                                    <Check className="w-4 h-4 text-rose-400" />
                                    <span>Cierre Formal y Archivo Definitivo</span>
                                  </h4>
                                  <p className="text-[11px] text-rose-200">
                                    Atención: El cierre formal es irreversible. El expediente se archivará como <strong>CERRADO</strong> y quedará inmutable en el historial.
                                  </p>

                                  <div>
                                    <label className="block text-[11px] text-slate-300 mb-1" htmlFor="close-notes">
                                      Justificación de Cierre y Archivo *
                                    </label>
                                    <textarea
                                      id="close-notes"
                                      rows={2}
                                      value={actionNotes}
                                      onChange={(e) => setActionNotes(e.target.value)}
                                      placeholder="Ej: Trámite concluido a satisfacción de las partes sin acciones adicionales pendientes..."
                                      className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-rose-500"
                                    />
                                  </div>

                                  <div className="flex justify-end space-x-2 pt-1">
                                    <button
                                      type="button"
                                      onClick={() => setIncidentActionType(null)}
                                      className="bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs px-3 py-1.5 rounded transition"
                                    >
                                      Cancelar
                                    </button>
                                    <button
                                      type="button"
                                      onClick={handleExecuteIncidentAction}
                                      disabled={incidentSubmitting || !actionNotes.trim()}
                                      className="bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-xs px-3 py-1.5 rounded font-medium transition flex items-center space-x-1"
                                    >
                                      {incidentSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                      <span>Cerrar Expediente</span>
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 text-center space-y-2">
                          <AlertCircle className="w-6 h-6 text-slate-500 mx-auto" />
                          <p className="text-xs font-semibold text-slate-300">Modo de Solo Lectura</p>
                          <p className="text-[11px] text-slate-500">
                            Su rol ({currentUser.role}) puede consultar los incidentes pero no posee permisos de supervisor para modificar su ciclo de vida.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 5: CENSO VEHICULAR */}
        {activeTab === "vehicles" && (
          <div className="space-y-6">
            {/* Registration Card (Authorized roles only) */}
            {canRegisterVehicles ? (
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
                <h2 className="text-base font-semibold text-white flex items-center space-x-2 mb-2">
                  <Car className="w-5 h-5 text-emerald-400" />
                  <span>Registrar Nuevo Vehículo en el Censo</span>
                </h2>
                <p className="text-xs text-slate-400 mb-4">
                  El censo asocia cada vehículo autorizado a este conjunto residencial. Las placas quedan disponibles para la lectura de portería y rondas.
                </p>

                {regMsg && (
                  <div className="mb-4 p-3 rounded-lg bg-emerald-950/80 border border-emerald-800 text-emerald-300 text-xs flex items-center space-x-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                    <span>{regMsg}</span>
                  </div>
                )}

                {regErr && (
                  <div className="mb-4 p-3 rounded-lg bg-rose-950/80 border border-rose-800 text-rose-300 text-xs flex items-center space-x-2">
                    <XCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
                    <span>{regErr}</span>
                  </div>
                )}

                <form onSubmit={handleRegisterVehicle} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1" htmlFor="new-plate">
                      Placa del Vehículo *
                    </label>
                    <input
                      id="new-plate"
                      type="text"
                      value={newPlate}
                      onChange={(e) => setNewPlate(e.target.value.toUpperCase())}
                      placeholder="Ej: ABC123"
                      maxLength={7}
                      required
                      className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white font-mono uppercase focus:outline-none focus:border-emerald-500 text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-slate-400 mb-1" htmlFor="new-space">
                      Parqueadero / Unidad
                    </label>
                    <input
                      id="new-space"
                      type="text"
                      value={newSpace}
                      onChange={(e) => setNewSpace(e.target.value)}
                      placeholder="Ej: Torre 1 - P102"
                      className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white focus:outline-none focus:border-emerald-500 text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-slate-400 mb-1" htmlFor="new-token">
                      Chip NFC / Sticker (Opcional)
                    </label>
                    <input
                      id="new-token"
                      type="text"
                      value={newStickerToken}
                      onChange={(e) => setNewStickerToken(e.target.value)}
                      placeholder="Ej: NFC-PC-ABC123"
                      className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white font-mono focus:outline-none focus:border-emerald-500 text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-slate-400 mb-1" htmlFor="new-presence">
                      Presencia Inicial
                    </label>
                    <select
                      id="new-presence"
                      value={newPresence}
                      onChange={(e) => setNewPresence(e.target.value as "INSIDE" | "AWAY")}
                      className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white focus:outline-none focus:border-emerald-500 text-sm"
                    >
                      <option value="INSIDE">Dentro (INSIDE)</option>
                      <option value="AWAY">Fuera (AWAY)</option>
                    </select>
                  </div>

                  <div className="sm:col-span-2 md:col-span-4 pt-1">
                    <button
                      type="submit"
                      disabled={regLoading || !newPlate.trim()}
                      className="bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs py-2.5 px-5 rounded-lg transition shadow disabled:opacity-50 flex items-center space-x-2"
                    >
                      {regLoading ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Guardando en base de datos...</span>
                        </>
                      ) : (
                        <span>Registrar en Censo Oficial</span>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            ) : (
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-xs text-slate-400 flex items-center space-x-3">
                <AlertCircle className="w-5 h-5 text-slate-500 flex-shrink-0" />
                <span>
                  El registro de vehículos está restringido a supervisores y administradores. Los guardas tienen acceso de consulta del censo vehicular.
                </span>
              </div>
            )}

            {/* Vehicle List with Search & Pagination */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-white">
                  Vehículos en el Censo ({vehicleTotal})
                </h3>

                {/* Search Bar */}
                <form onSubmit={handleSearchSubmit} className="flex items-center space-x-2">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input
                      type="text"
                      value={vehicleSearch}
                      onChange={(e) => setVehicleSearch(e.target.value)}
                      placeholder="Buscar placa o espacio..."
                      className="bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 w-48 sm:w-64"
                    />
                  </div>
                  <button
                    type="submit"
                    className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs px-3 py-1.5 rounded-lg transition"
                  >
                    Buscar
                  </button>
                  {vehicleSearch && (
                    <button
                      type="button"
                      onClick={handleClearSearch}
                      className="text-xs text-slate-400 hover:text-white"
                    >
                      Limpiar
                    </button>
                  )}
                </form>
              </div>

              {vehiclesError && (
                <div className="p-3 rounded-lg bg-rose-950/80 border border-rose-800 text-rose-300 text-xs flex items-center space-x-2">
                  <XCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
                  <span>{vehiclesError}</span>
                </div>
              )}

              {vehiclesLoading ? (
                <div className="py-12 text-center text-slate-500 text-xs flex flex-col items-center justify-center space-y-2">
                  <Loader2 className="w-6 h-6 animate-spin text-emerald-400" />
                  <span>Cargando vehículos desde el servidor...</span>
                </div>
              ) : vehicles.length === 0 ? (
                <div className="py-10 text-center bg-slate-950/40 rounded-xl border border-slate-800/60 p-4">
                  <Car className="w-7 h-7 text-slate-600 mx-auto mb-2" />
                  <p className="text-xs text-slate-300">No se encontraron vehículos registrados.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                      <tr>
                        <th className="py-2.5 px-3">Placa</th>
                        <th className="py-2.5 px-3">Parqueadero / Ubicación</th>
                        <th className="py-2.5 px-3">Chip NFC / Sticker</th>
                        <th className="py-2.5 px-3">Presencia Actual</th>
                        <th className="py-2.5 px-3">Registrado</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {vehicles.map((v) => (
                        <tr key={v.id} className="hover:bg-slate-800/50 transition">
                          <td className="py-2.5 px-3 font-mono font-bold text-white">{v.plate}</td>
                          <td className="py-2.5 px-3 text-slate-300">{v.parkingSpace || "Sin espacio"}</td>
                          <td className="py-2.5 px-3 font-mono text-slate-400">{v.stickerToken || "—"}</td>
                          <td className="py-2.5 px-3">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                v.presenceStatus === "INSIDE"
                                  ? "bg-emerald-950 text-emerald-400 border border-emerald-800"
                                  : v.presenceStatus === "AWAY"
                                  ? "bg-blue-950 text-blue-400 border border-blue-800"
                                  : "bg-rose-950 text-rose-400 border border-rose-800"
                              }`}
                            >
                              {v.presenceStatus}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-slate-400">
                            {new Date(v.createdAt).toLocaleDateString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Pagination Controls */}
              {vehicleTotalPages > 1 && (
                <div className="flex items-center justify-between pt-3 border-t border-slate-800 text-xs">
                  <span className="text-slate-400">
                    Página {vehiclePage} de {vehicleTotalPages} ({vehicleTotal} registros)
                  </span>
                  <div className="flex space-x-2">
                    <button
                      onClick={() => fetchVehicles(vehiclePage - 1, vehicleSearch)}
                      disabled={vehiclePage <= 1 || vehiclesLoading}
                      className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-3 py-1 rounded disabled:opacity-40 flex items-center space-x-1"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                      <span>Anterior</span>
                    </button>
                    <button
                      onClick={() => fetchVehicles(vehiclePage + 1, vehicleSearch)}
                      disabled={vehiclePage >= vehicleTotalPages || vehiclesLoading}
                      className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-3 py-1 rounded disabled:opacity-40 flex items-center space-x-1"
                    >
                      <span>Siguiente</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 6: DASHBOARD / MÉTRICAS */}
        {activeTab === "dashboard" && (
          <div className="space-y-6">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-semibold text-white flex items-center space-x-2">
                  <ShieldCheck className="w-5 h-5 text-emerald-400" />
                  <span>Tablero Operativo y Métricas Autoritativas</span>
                </h2>
                <button
                  onClick={fetchMetrics}
                  disabled={metricsLoading}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs px-3 py-1.5 rounded-lg flex items-center space-x-1.5 transition disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${metricsLoading ? "animate-spin" : ""}`} />
                  <span>Refrescar</span>
                </button>
              </div>

              {metricsError && (
                <div className="p-3 rounded-lg bg-rose-950/80 border border-rose-800 text-rose-300 text-xs flex items-center space-x-2 mb-4">
                  <XCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
                  <span>{metricsError}</span>
                </div>
              )}

              {metricsLoading && !metrics ? (
                <div className="py-12 text-center text-slate-500 text-xs flex flex-col items-center justify-center space-y-2">
                  <Loader2 className="w-6 h-6 animate-spin text-emerald-400" />
                  <span>Consultando métricas en tiempo real...</span>
                </div>
              ) : metrics ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-4">
                    <span className="text-xs text-slate-400 block mb-1">Vehículos Dentro (INSIDE)</span>
                    <span className="text-2xl font-bold text-emerald-400">{metrics.insideCount}</span>
                    <span className="text-[10px] text-slate-500 block mt-1">Con presencia confirmada</span>
                  </div>

                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-4">
                    <span className="text-xs text-slate-400 block mb-1">Vehículos Fuera (AWAY)</span>
                    <span className="text-2xl font-bold text-blue-400">{metrics.awayCount}</span>
                    <span className="text-[10px] text-slate-500 block mt-1">Excluidos de rondas programadas</span>
                  </div>

                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-4">
                    <span className="text-xs text-slate-400 block mb-1">Presencia Incierta (UNCERTAIN)</span>
                    <span className="text-2xl font-bold text-amber-400">{metrics.uncertainCount}</span>
                    <span className="text-[10px] text-slate-500 block mt-1">Requieren verificación física</span>
                  </div>

                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-4">
                    <span className="text-xs text-slate-400 block mb-1">Inspecciones de Retorno</span>
                    <span className="text-2xl font-bold text-amber-300">{metrics.pendingReturnCount}</span>
                    <span className="text-[10px] text-slate-500 block mt-1">Prioridad máxima en cola</span>
                  </div>

                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-4">
                    <span className="text-xs text-slate-400 block mb-1">Rondas Programadas Pendientes</span>
                    <span className="text-2xl font-bold text-slate-200">{metrics.pendingScheduledCount}</span>
                    <span className="text-[10px] text-slate-500 block mt-1">Vehículos activos dentro</span>
                  </div>

                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-4">
                    <span className="text-xs text-slate-400 block mb-1">Tareas Vencidas (OVERDUE)</span>
                    <span className="text-2xl font-bold text-rose-400">{metrics.overdueCount}</span>
                    <span className="text-[10px] text-slate-500 block mt-1">Superaron tiempo de gracia</span>
                  </div>

                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-4">
                    <span className="text-xs text-slate-400 block mb-1">Fallas de Inspección</span>
                    <span className="text-2xl font-bold text-rose-300">{metrics.failedCount}</span>
                    <span className="text-[10px] text-slate-500 block mt-1">Impedimentos reportados</span>
                  </div>

                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-4">
                    <span className="text-xs text-slate-400 block mb-1">Incidentes Abiertos</span>
                    <span className="text-2xl font-bold text-amber-400">{metrics.openIncidentsCount}</span>
                    <span className="text-[10px] text-slate-500 block mt-1">En investigación o seguimiento</span>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-slate-400">Sin datos disponibles.</p>
              )}
            </div>
          </div>
        )}

        {/* TAB 7: REPORTES CSV */}
        {activeTab === "reports" && (
          <div className="space-y-6">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
              <h2 className="text-base font-semibold text-white flex items-center space-x-2 mb-2">
                <FileSpreadsheet className="w-5 h-5 text-emerald-400" />
                <span>Exportación de Registros Oficiales (Auditoría CSV)</span>
              </h2>
              <p className="text-xs text-slate-400 mb-4">
                Descargue archivos CSV con el registro auditable de inspecciones, movimientos o incidentes para control de copropiedad y pólizas.
              </p>

              {!canExportReports ? (
                <div className="p-4 rounded-xl bg-amber-950/40 border border-amber-800/80 text-amber-300 text-xs flex items-center space-x-3">
                  <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0" />
                  <span>
                    La exportación de reportes está restringida a Supervisores y Administradores de la copropiedad. Su rol ({currentUser.role}) no tiene permisos de exportación.
                  </span>
                </div>
              ) : (
                <div className="max-w-md space-y-4">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1" htmlFor="export-type">
                      Tipo de Registro a Exportar
                    </label>
                    <select
                      id="export-type"
                      value={exportType}
                      onChange={(e) => setExportType(e.target.value as any)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-emerald-500"
                    >
                      <option value="inspections">Registro de Inspecciones y Rondas</option>
                      <option value="movements">Historial de Movimientos de Portería</option>
                      <option value="incidents">Folios de Incidentes y Daños Observados</option>
                    </select>
                  </div>

                  <a
                    href={`/api/reports/export?type=${exportType}`}
                    download
                    className="inline-flex items-center space-x-2 bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs py-2.5 px-4 rounded-lg transition shadow"
                  >
                    <ExternalLink className="w-4 h-4" />
                    <span>Descargar Reporte CSV Autorizado</span>
                  </a>
                </div>
              )}
            </div>
          </div>
        )}
    </DashboardShell>
  );
}
