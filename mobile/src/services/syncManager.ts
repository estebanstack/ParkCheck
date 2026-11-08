// ParkCheck Mobile - Sync Manager & Outbox Orchestrator
// Ensures safe, deterministic upload of queued events, idempotency preservation, and error handling

import { StorageService } from "./storage";
import { ApiClient } from "./api";
import { SyncBatchRequest, SyncEventResult } from "../../../src/domain/syncTypes";

export interface SyncExecutionResult {
  totalProcessed: number;
  syncedCount: number;
  failedCount: number;
  conflictCount: number;
  errors: string[];
  isOfflineMode?: boolean;
  offlineMessage?: string;
}

export const SyncManager = {
  isSyncing: false,

  async synchronize(): Promise<SyncExecutionResult> {
    if (this.isSyncing) {
      return { totalProcessed: 0, syncedCount: 0, failedCount: 0, conflictCount: 0, errors: ["Sincronización ya en curso"] };
    }

    const session = await StorageService.getSession();
    if (!session || !session.token) {
      return { totalProcessed: 0, syncedCount: 0, failedCount: 0, conflictCount: 0, errors: ["No autenticado"] };
    }

    const outbox = await StorageService.getOutbox();
    const pendingItems = outbox.filter(
      (item) => item.syncStatus === "PENDING_SYNC" || item.syncStatus === "SYNC_FAILED"
    );

    if (pendingItems.length === 0) {
      return { totalProcessed: 0, syncedCount: 0, failedCount: 0, conflictCount: 0, errors: [] };
    }

    // Honest handling of local turn / offline mode
    if (session.isOfflineMode || session.token.startsWith("offline_")) {
      return {
        totalProcessed: pendingItems.length,
        syncedCount: 0,
        failedCount: 0,
        conflictCount: 0,
        errors: [],
        isOfflineMode: true,
        offlineMessage: `Modo Local Activo: ${pendingItems.length} evento(s) resguardados con seguridad en este dispositivo. Para sincronizar con el servidor central se requiere haber iniciado turno con credenciales de red.`,
      };
    }

    this.isSyncing = true;
    const errors: string[] = [];
    let syncedCount = 0;
    let failedCount = 0;
    let conflictCount = 0;

    try {
      // 1. Transition items to SYNCING
      for (const item of pendingItems) {
        await StorageService.updateItemStatus(item.clientEventId, "SYNCING");
      }

      // 2. Prepare Batch Request
      const batchRequest: SyncBatchRequest = {
        complexId: session.user.complexId,
        clientBatchId: `batch-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        events: pendingItems.map((item) => ({
          ...item.payload,
          clientEventId: item.clientEventId,
          complexId: session.user.complexId,
          eventType: item.eventType,
          recordedAt: item.createdAt,
        })),
      };

      // 3. Transmit to server
      const batchResponse = await ApiClient.syncBatch(session.token, batchRequest);

      // 4. Update local outbox items from server acknowledgments
      const resultMap = new Map<string, SyncEventResult>();
      for (const r of batchResponse.results) {
        resultMap.set(r.clientEventId, r);
      }

      for (const item of pendingItems) {
        const ack = resultMap.get(item.clientEventId);
        if (!ack) {
          // No acknowledgment received for this item: keep for retry
          await StorageService.updateItemStatus(item.clientEventId, "SYNC_FAILED", {
            lastError: "Sin respuesta de confirmación del servidor para este evento",
          });
          failedCount++;
          continue;
        }

        if (ack.status === "ACKNOWLEDGED" || ack.status === "DUPLICATE_ACKNOWLEDGED") {
          await StorageService.updateItemStatus(item.clientEventId, "SYNCED", {
            serverId: ack.entityId,
            syncedAt: ack.serverReceivedAt,
          });
          syncedCount++;
        } else if (ack.status === "CONFLICT_FLAGGED") {
          await StorageService.updateItemStatus(item.clientEventId, "SYNCED", {
            serverId: ack.entityId,
            conflictFlagged: true,
            conflictReason: ack.conflictReason,
            syncedAt: ack.serverReceivedAt,
          });
          conflictCount++;
          syncedCount++;
        } else {
          // REJECTED
          await StorageService.updateItemStatus(item.clientEventId, "SYNC_FAILED", {
            lastError: ack.error || "Evento rechazado por el servidor",
          });
          errors.push(`[${item.clientEventId}] ${ack.error || "Rechazado"}`);
          failedCount++;
        }
      }
    } catch (netErr: any) {
      // Network disconnect or timeout: Retain all pending records!
      errors.push(netErr.message || "Error de conexión de red");
      for (const item of pendingItems) {
        await StorageService.updateItemStatus(item.clientEventId, "SYNC_FAILED", {
          lastError: netErr.message || "Fallo de conexión",
        });
        failedCount++;
      }
    } finally {
      this.isSyncing = false;
    }

    return {
      totalProcessed: pendingItems.length,
      syncedCount,
      failedCount,
      conflictCount,
      errors,
    };
  },
};
