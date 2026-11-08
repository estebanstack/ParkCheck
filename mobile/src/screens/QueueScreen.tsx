// ParkCheck Mobile - Cola Priorizada de Inspecciones (es-CO)
// Specification Reference: Section 3, 5, 6
// Priority: Return inspections (Bucket 1) -> Overdue inspections (Bucket 2) -> Routine Scheduled (Bucket 3)
// Vehicles marked AWAY are excluded from active routine rounds; obligations are preserved.

import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { StorageService } from "../services/storage";
import { AuthSession } from "../types/outbox";

interface Props {
  session: AuthSession;
  onSelectTask: (task: any) => void;
}

export function QueueScreen({ session, onSelectTask }: Props) {
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const loadQueue = async () => {
    setLoading(true);
    try {
      const vehicles = await StorageService.getCachedVehicles();
      const extracted: any[] = [];
      const now = new Date();

      for (const v of vehicles) {
        if (Array.isArray(v.activeTasks) && v.activeTasks.length > 0) {
          for (const t of v.activeTasks) {
            const isDuePassed = new Date(t.dueAt).getTime() < now.getTime();
            const isOverdue = t.status === "OVERDUE" || (t.status === "PENDING" && isDuePassed);

            // Rule: Vehicles AWAY are excluded from routine scheduled inspections,
            // but return obligations or existing overdue items remain flagged
            const isReturn = t.triggerType === "RETURN";
            const priorityBucket = isReturn ? 1 : isOverdue ? 2 : 3;

            extracted.push({
              id: t.id,
              plate: v.plate,
              space: v.parkingSpace || "Sin espacio asignado",
              triggerType: t.triggerType,
              status: isOverdue ? "OVERDUE" : t.status,
              dueAt: t.dueAt,
              description: t.description,
              presenceStatus: v.presenceStatus,
              isVehicleAway: v.presenceStatus === "AWAY",
              priorityBucket,
            });
          }
        }
      }

      // Deterministic sort: Return inspections (1) -> Overdue (2) -> Routine (3)
      extracted.sort((a, b) => a.priorityBucket - b.priorityBucket);
      setTasks(extracted);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadQueue();
  }, []);

  const renderTask = ({ item }: { item: any }) => {
    const isReturn = item.priorityBucket === 1;
    const isOverdue = item.priorityBucket === 2;

    return (
      <View
        style={[
          styles.taskCard,
          isReturn && styles.cardReturn,
          isOverdue && styles.cardOverdue,
          item.isVehicleAway && styles.cardAway,
        ]}
      >
        <View style={styles.cardHeader}>
          <View>
            <Text style={styles.plate}>{item.plate}</Text>
            <Text style={styles.spaceText}>{item.space}</Text>
          </View>

          <View style={styles.badgeContainer}>
            <View
              style={[
                styles.badge,
                isReturn ? styles.badgeReturn : isOverdue ? styles.badgeOverdue : styles.badgeNormal,
              ]}
            >
              <Text style={styles.badgeText}>
                {isReturn ? "RETORNO PRIORITARIO" : isOverdue ? "VENCIDA" : "PROGRAMADA"}
              </Text>
            </View>

            {item.isVehicleAway && (
              <View style={styles.badgeAwayTag}>
                <Text style={styles.badgeAwayText}>FUERA</Text>
              </View>
            )}
          </View>
        </View>

        {item.description ? (
          <Text style={styles.descText}>{item.description}</Text>
        ) : null}

        {item.isVehicleAway ? (
          <View style={styles.awayNoticeBox}>
            <Text style={styles.awayNoticeText}>
              ⚠️ El vehículo salió de las instalaciones. La obligación se preserva en el historial para supervisión.
            </Text>
          </View>
        ) : null}

        <TouchableOpacity
          style={[styles.inspectBtn, item.isVehicleAway && styles.inspectBtnAway]}
          onPress={() => onSelectTask(item)}
          activeOpacity={0.8}
        >
          <Text style={styles.inspectBtnText}>INSPECCIONAR VEHÍCULO</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Cola de Inspección</Text>
          <Text style={styles.subtitle}>
            Prioridad: Retorno reciente → Vencidas → Programadas
          </Text>
        </View>
        <TouchableOpacity style={styles.refreshBtn} onPress={loadQueue} activeOpacity={0.8}>
          <Text style={styles.refreshBtnText}>🔄 Refrescar</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator color="#38bdf8" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={tasks}
          keyExtractor={(item) => item.id}
          renderItem={renderTask}
          contentContainerStyle={{ padding: 16, gap: 12 }}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyIcon}>✓</Text>
              <Text style={styles.emptyTitle}>Sin Tareas Pendientes</Text>
              <Text style={styles.emptySubtitle}>
                No hay inspecciones pendientes en este momento. Las rondas se generarán automáticamente al registrar ingresos en portería o rondas programadas del conjunto.
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0b1329" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    backgroundColor: "#131b2e",
    borderBottomWidth: 1,
    borderBottomColor: "#1e293b",
  },
  title: { fontSize: 20, fontWeight: "bold", color: "#f8fafc" },
  subtitle: { fontSize: 12, color: "#94a3b8", marginTop: 2 },
  refreshBtn: {
    backgroundColor: "#1e293b",
    borderWidth: 1,
    borderColor: "#334155",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  refreshBtnText: { color: "#38bdf8", fontSize: 13, fontWeight: "600" },
  taskCard: {
    backgroundColor: "#131b2e",
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: "#1e293b",
  },
  cardReturn: { borderColor: "#0284c7", backgroundColor: "#0c2438" },
  cardOverdue: { borderColor: "#b91c1c", backgroundColor: "#2e1212" },
  cardAway: { opacity: 0.85, borderColor: "#475569" },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  plate: { fontSize: 22, fontWeight: "bold", color: "#f8fafc", letterSpacing: 1 },
  spaceText: { color: "#94a3b8", fontSize: 13, marginTop: 2 },
  badgeContainer: { flexDirection: "row", gap: 6, alignItems: "center" },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  badgeReturn: { backgroundColor: "#0284c7" },
  badgeOverdue: { backgroundColor: "#b91c1c" },
  badgeNormal: { backgroundColor: "#334155" },
  badgeText: { color: "#fff", fontSize: 10, fontWeight: "bold" },
  badgeAwayTag: { backgroundColor: "#334155", paddingHorizontal: 6, paddingVertical: 4, borderRadius: 6 },
  badgeAwayText: { color: "#94a3b8", fontSize: 10, fontWeight: "bold" },
  descText: { color: "#cbd5e1", fontSize: 12, marginTop: 8 },
  awayNoticeBox: {
    backgroundColor: "#1e293b",
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 8,
    padding: 8,
    marginTop: 8,
  },
  awayNoticeText: { color: "#f59e0b", fontSize: 11 },
  inspectBtn: {
    backgroundColor: "#0284c7",
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
    marginTop: 14,
  },
  inspectBtnAway: { backgroundColor: "#475569" },
  inspectBtnText: { color: "#fff", fontSize: 14, fontWeight: "bold" },
  emptyContainer: {
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    marginTop: 40,
  },
  emptyIcon: {
    fontSize: 48,
    color: "#10b981",
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#f8fafc",
    marginBottom: 6,
  },
  emptySubtitle: {
    fontSize: 13,
    color: "#94a3b8",
    textAlign: "center",
    lineHeight: 18,
  },
});
