// ParkCheck - Domain Types & Pure State Logic
// Specification Reference: Section 3, 5, 6, 10, 14

export type PresenceStatus = "INSIDE" | "AWAY" | "UNCERTAIN";
export type MovementType = "ARRIVAL" | "DEPARTURE";
export type TriggerType = "SCHEDULED" | "RETURN";
export type TaskStatus = "PENDING" | "COMPLETED" | "OVERDUE" | "UNABLE_TO_COMPLETE" | "CANCELLED";
export type InspectionResult = "NO_VISIBLE_INCIDENT" | "DAMAGE_OBSERVED" | "UNABLE_TO_COMPLETE";
export type IncidentStatus =
  | "REPORTED"
  | "AWAITING_REVIEW"
  | "UNDER_INVESTIGATION"
  | "OWNER_CONTACT_PENDING"
  | "OWNER_CONTACTED"
  | "RESOLVED"
  | "CLOSED";

export type SiteRole =
  | "ENTRANCE_GUARD"
  | "PARKING_GUARD"
  | "SUPERVISOR"
  | "RESIDENTIAL_ADMIN"
  | "PLATFORM_ADMIN";

export interface ComplexPolicy {
  inspectionIntervalMinutes: number; // e.g. 60 or 120
  overdueGraceMinutes: number; // provisional default: 15
  returnSatisfiesScheduledPolicy: "NEVER" | "WITHIN_WINDOW"; // provisional default: NEVER
  returnWindowMinutes: number; // provisional default: 30
  departureWithPendingTaskPolicy: "KEEP_PENDING" | "FLAG_FOR_SUPERVISOR_REVIEW"; // provisional default
  queueAlertOrderPolicy: "RETURN_FIRST_ALERTS_PINNED" | "STANDARD_PRIORITY";
  overdueEscalationMinutes: number; // provisional default: 30
  movementDedupSeconds: number; // provisional default: 60
  retentionDaysPhotos: number;
  retentionDaysRecords: number;
}

export const DEFAULT_COMPLEX_POLICY: ComplexPolicy = {
  inspectionIntervalMinutes: 60,
  overdueGraceMinutes: 15,
  returnSatisfiesScheduledPolicy: "NEVER",
  returnWindowMinutes: 30,
  departureWithPendingTaskPolicy: "FLAG_FOR_SUPERVISOR_REVIEW",
  queueAlertOrderPolicy: "RETURN_FIRST_ALERTS_PINNED",
  overdueEscalationMinutes: 30,
  movementDedupSeconds: 60,
  retentionDaysPhotos: 365,
  retentionDaysRecords: 365,
};

export interface VehicleEntity {
  id: string;
  complexId: string;
  plate: string;
  parkingSpace?: string | null;
  stickerToken?: string | null;
  active: boolean;
}

export interface VehiclePresenceEntity {
  vehicleId: string;
  currentStatus: PresenceStatus;
  lastMovementEventId?: string | null;
  statusUpdatedAt: Date;
  verificationDetails?: string | null;
}

export interface MovementEventEntity {
  id: string;
  complexId: string;
  vehicleId: string;
  eventType: MovementType;
  recordedAt: Date;
  recordedById?: string | null;
  source: string;
  idempotencyKey?: string | null;
  notes?: string | null;
}

export interface InspectionTaskEntity {
  id: string;
  complexId: string;
  vehicleId: string;
  triggerType: TriggerType;
  status: TaskStatus;
  dueAt: Date;
  completedAt?: Date | null;
  isLate: boolean;
  relatedMovementId?: string | null;
  unableToCompleteReason?: string | null;
  cancellationReason?: string | null;
  createdAt: Date;
  updatedAt: Date;
}
