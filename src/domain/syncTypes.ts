// ParkCheck - Offline Synchronization Types & Contracts
// Specification Reference: Section 4, 8, 14, 15

import { MovementType, InspectionResult, TaskStatus, SiteRole } from "./types";

export type OutboxEventState = "PENDING_SYNC" | "SYNCING" | "SYNCED" | "SYNC_FAILED";

export interface BaseClientEvent {
  clientEventId: string; // Client-generated UUID
  complexId: string;
  recordedAt: string; // ISO timestamp when guard recorded the action offline
  source?: string; // NFC_SCAN | QR_SCAN | GATE_MANUAL
}

export interface ClientMovementEvent extends BaseClientEvent {
  eventType: "MOVEMENT";
  plate: string;
  movementType: MovementType; // ARRIVAL | DEPARTURE
  notes?: string;
  idempotencyKey?: string;
}

export interface ClientInspectionEvent extends BaseClientEvent {
  eventType: "INSPECTION";
  taskId: string;
  vehiclePlate: string;
  result: InspectionResult; // NO_VISIBLE_INCIDENT | DAMAGE_OBSERVED | UNABLE_TO_COMPLETE
  description?: string;
  unableToCompleteReason?: string;
  surveillanceRequired?: boolean;
  ownerContactRequired?: boolean;
}

export interface ClientIncidentEvent extends BaseClientEvent {
  eventType: "INCIDENT";
  vehiclePlate: string;
  description: string;
  surveillanceRequired?: boolean;
  ownerContactRequired?: boolean;
  localAttachmentIds?: string[];
}

export interface ClientAttachmentEvent extends BaseClientEvent {
  eventType: "ATTACHMENT";
  incidentClientEventId?: string;
  incidentServerId?: string;
  originalName: string;
  mimeType: string;
  fileSize: number;
  base64Data?: string;
  attachmentType?: "DAMAGE_PHOTO" | "INSPECTION_PHOTO";
}

export type AnyClientSyncEvent =
  | ClientMovementEvent
  | ClientInspectionEvent
  | ClientIncidentEvent
  | ClientAttachmentEvent;

export interface SyncBatchRequest {
  complexId: string;
  clientBatchId: string;
  events: AnyClientSyncEvent[];
}

export type SyncResultStatus =
  | "ACKNOWLEDGED"
  | "DUPLICATE_ACKNOWLEDGED"
  | "CONFLICT_FLAGGED"
  | "REJECTED";

export interface SyncEventResult {
  clientEventId: string;
  eventType: "MOVEMENT" | "INSPECTION" | "INCIDENT" | "ATTACHMENT";
  status: SyncResultStatus;
  entityId?: string;
  error?: string;
  conflictReason?: string;
  clientRecordedAt: string;
  serverReceivedAt: string;
}

export interface SyncBatchResponse {
  success: boolean;
  batchId: string;
  complexId: string;
  processedAt: string;
  serverTime: string;
  totalEvents: number;
  acknowledgedCount: number;
  duplicateCount: number;
  conflictCount: number;
  rejectedCount: number;
  results: SyncEventResult[];
}
