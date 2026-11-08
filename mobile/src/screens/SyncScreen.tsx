// ParkCheck Mobile - Monitor de Sincronización Offline y Cola Outbox (es-CO)
// Specification Reference: Section 3, 4, 8

import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from "react-native";
import { StorageService } from "../services/storage";
import { SyncManager } from "../services/syncManager";
import { OutboxItem, AuthSession } from "../types/outbox";

export function SyncScreen() {
  const [items, setItems] = useState<OutboxItem[]>([]);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [syncing, setSyncing] = useState(false);

  const loadOutbox = async () => {
    const list = await StorageService.getOutbox();
    const curSession = await StorageService.getSession();
    setSession(curSession);
    setItems([...list].reverse());
  };

  useEffect(() => {
    loadOutbox();
  }, []);

  const isLocalMode = !session || session.isOfflineMode || session.token.startsWith("offline_");

  const handleManualSync = async () => {
    setSyncing(true);
    try {
      const res = await SyncManager.synchronize();
      await loadOutbox();

      if (res.isOfflineMode) {
        Alert.alert(
          "Modo Local Activo",
          res.offlineMessage || "Los eventos están resguardados localmente en la memoria del dispositivo."
        );
      } else {
        Alert.alert(
          "Sincronización con Servidor",
          `Eventos procesados: ${res.totalProcessed}\nConfirmados por servidor: ${res.syncedCount}\nConflictos registrados: ${res.conflictCount}\nFallidos / Pendientes: ${res.failedCount}`
        );
      }
    } catch (err: any) {
      Alert.alert("Estado de Conexión", err.message || "No fue posible conectar con el servidor central.");
    } finally {
      setSyncing(false);
    }
  };

  const handleClearSynced = async () => {
    await StorageService.clearSyncedItems();
    await loadOutbox();
  };

  const pendingCount = items.filter(
    (i) => i.syncStatus === "PENDING_SYNC" || i.syncStatus === "SYNC_FAILED" || i.syncStatus === "SYNCING"
  ).length;
  const syncedCount = items.filter((i) => i.syncStatus === "SYNCED").length;

  const renderItem = ({ item }: { item: OutboxItem }) => {
    const isSynced = item.syncStatus === "SYNCED";
    const isFailed = item.syncStatus === "SYNC_FAILED";

    let eventTypeLabel: string = item.eventType;
    if (item.eventType === "MOVEMENT") {
      eventTypeLabel = item.payload?.movementType === "ARRIVAL" ? "Ingreso Vehicular" : "Salida Vehicular";
    } else if (item.eventType === "INSPECTION") {
      eventTypeLabel = "Inspección de Condición";
    } else if (item.eventType === "INCIDENT") {
      eventTypeLabel = "Reporte de Novedad";
    } else if (item.eventType === "ATTACHMENT") {
      eventTypeLabel = "Foto de Evidencia";
    } else if (item.eventType === "VEHICLE_REGISTRATION") {
      eventTypeLabel = "Registro al Censo";
    }

    return (
      <View
        style={[
          styles.itemCard,
          isFailed && !isLocalMode && styles.cardFailed,
          item.conflictFlagged && styles.cardConflict,
        ]}
      >
        <View style={styles.itemHeader}>
          <Text style={styles.eventType}>{eventTypeLabel}</Text>
          <View
            style={[
              styles.statusBadge,
              isSynced
                ? styles.badgeSynced
                : isLocalMode
                ? styles.badgeLocal
                : isFailed
                ? styles.badgeFailed
                : styles.badgePending,
            ]}
          >
            <Text style={styles.statusText}>
              {isSynced
                ? "CONFIRMADO SERVIDOR"
                : isLocalMode
                ? "GUARDADO LOCAL"
                : isFailed
                ? "FALLO TRANSMISIÓN"
                : "PENDIENTE"}
            </Text>
          </View>
        </View>

        <Text style={styles.itemDetails}>
          Placa / Ref: {item.payload?.plate || item.payload?.vehiclePlate || item.payload?.originalName || "N/A"}
        </Text>

        <Text style={styles.itemDate}>
          Grabado: {new Date(item.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
        </Text>

        {item.conflictFlagged && (
          <View style={styles.conflictBox}>
            <Text style={styles.conflictTitle}>⚠️ Conflicto de Presencia Registrado:</Text>
            <Text style={styles.conflictReason}>{item.conflictReason}</Text>
          </View>
        )}

        {item.lastError && !isLocalMode && (
          <Text style={styles.errorText}>Error: {item.lastError}</Text>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Mode explanation card */}
      <View style={[styles.modeCard, isLocalMode ? styles.modeCardLocal : styles.modeCardOnline]}>
        <Text style={styles.modeCardTitle}>
          {isLocalMode ? "📱 Turno Local (Memoria del Dispositivo)" : "🌐 Turno Conectado con Servidor"}
        </Text>
        <Text style={styles.modeCardDesc}>
          {isLocalMode
            ? "Todos los eventos están asegurados en la base interna de este teléfono. No se pierden al cerrar la aplicación o reiniciar el dispositivo."
            : "Los eventos pendientes se sincronizan automáticamente con la base de datos central de portería."}
        </Text>
      </View>

      {/* Stats bar */}
      <View style={styles.statsBar}>
        <View style={styles.statBox}>
          <Text style={styles.statNumber}>{pendingCount}</Text>
          <Text style={styles.statLabel}>{isLocalMode ? "Eventos en Dispositivo" : "Pendientes Sincronizar"}</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={styles.statNumber}>{syncedCount}</Text>
          <Text style={styles.statLabel}>Confirmados Servidor</Text>
        </View>
      </View>

      {/* Actions */}
      <View style={styles.actionsBar}>
        <TouchableOpacity
          style={[styles.syncBtn, syncing && styles.btnDisabled]}
          onPress={handleManualSync}
          disabled={syncing}
          activeOpacity={0.8}
        >
          {syncing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.syncBtnText}>
              {isLocalMode ? "🔄 ACTUALIZAR ESTADO" : "🔄 SINCRONIZAR AHORA"}
            </Text>
          )}
        </TouchableOpacity>

        {syncedCount > 0 && (
          <TouchableOpacity style={styles.clearBtn} onPress={handleClearSynced} activeOpacity={0.8}>
            <Text style={styles.clearBtnText}>Limpiar Confirmados</Text>
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => item.clientEventId}
        renderItem={renderItem}
        contentContainerStyle={{ padding: 16, gap: 10 }}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>📂</Text>
            <Text style={styles.emptyTitle}>Cola Local Vacía</Text>
            <Text style={styles.emptySubtitle}>No hay eventos pendientes de transmisión en este dispositivo.</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0b1329" },
  modeCard: { padding: 14, marginHorizontal: 16, marginTop: 14, borderRadius: 12, borderWidth: 1 },
  modeCardLocal: { backgroundColor: "#1c1917", borderColor: "#d97706" },
  modeCardOnline: { backgroundColor: "#064e3b", borderColor: "#10b981" },
  modeCardTitle: { color: "#f8fafc", fontSize: 14, fontWeight: "bold", marginBottom: 4 },
  modeCardDesc: { color: "#cbd5e1", fontSize: 12, lineHeight: 16 },
  statsBar: {
    flexDirection: "row",
    padding: 16,
    gap: 12,
  },
  statBox: {
    flex: 1,
    alignItems: "center",
    backgroundColor: "#131b2e",
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#1e293b",
  },
  statNumber: { fontSize: 26, fontWeight: "bold", color: "#38bdf8" },
  statLabel: { fontSize: 12, color: "#94a3b8", marginTop: 4, textAlign: "center" },
  actionsBar: { flexDirection: "row", paddingHorizontal: 16, paddingBottom: 10, gap: 10 },
  syncBtn: {
    flex: 2,
    backgroundColor: "#0284c7",
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
  },
  syncBtnText: { color: "#fff", fontWeight: "bold", fontSize: 14 },
  clearBtn: {
    flex: 1,
    backgroundColor: "#1e293b",
    borderWidth: 1,
    borderColor: "#334155",
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
  },
  clearBtnText: { color: "#94a3b8", fontSize: 12, fontWeight: "600" },
  btnDisabled: { opacity: 0.6 },
  itemCard: {
    backgroundColor: "#131b2e",
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#1e293b",
  },
  cardFailed: { borderColor: "#ef4444" },
  cardConflict: { borderColor: "#f59e0b", backgroundColor: "#2e1a05" },
  itemHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  eventType: { fontSize: 15, fontWeight: "bold", color: "#f8fafc" },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  badgeLocal: { backgroundColor: "#92400e" },
  badgePending: { backgroundColor: "#d97706" },
  badgeSynced: { backgroundColor: "#059669" },
  badgeFailed: { backgroundColor: "#dc2626" },
  statusText: { color: "#fff", fontSize: 10, fontWeight: "bold" },
  itemDetails: { color: "#38bdf8", fontSize: 14, marginTop: 4, fontWeight: "600" },
  itemDate: { color: "#94a3b8", fontSize: 12, marginTop: 2 },
  conflictBox: { marginTop: 8, backgroundColor: "#451a03", padding: 8, borderRadius: 6 },
  conflictTitle: { color: "#f59e0b", fontSize: 12, fontWeight: "bold" },
  conflictReason: { color: "#fed7aa", fontSize: 12, marginTop: 2 },
  errorText: { color: "#f87171", fontSize: 12, marginTop: 6 },
  emptyContainer: { alignItems: "center", justifyContent: "center", padding: 32, marginTop: 40 },
  emptyIcon: { fontSize: 44, marginBottom: 12 },
  emptyTitle: { fontSize: 18, fontWeight: "bold", color: "#f8fafc", marginBottom: 6 },
  emptySubtitle: { fontSize: 13, color: "#94a3b8", textAlign: "center" },
});
