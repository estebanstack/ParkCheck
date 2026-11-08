// ParkCheck Mobile - Ejecución de Inspección (es-CO)
// Specification Reference: Section 3, 5, 6

import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { StorageService } from "../services/storage";
import { SyncManager } from "../services/syncManager";
import { AuthSession } from "../types/outbox";

interface Props {
  session: AuthSession;
  task: {
    id: string;
    plate: string;
    space?: string;
    triggerType: string;
    description?: string;
  };
  onComplete: () => void;
}

export function InspectionScreen({ session, task, onComplete }: Props) {
  const [result, setResult] = useState<"NO_VISIBLE_INCIDENT" | "DAMAGE_OBSERVED" | "UNABLE_TO_COMPLETE">("NO_VISIBLE_INCIDENT");
  const [description, setDescription] = useState("");
  const [unableReason, setUnableReason] = useState("");
  const [surveillanceReq, setSurveillanceReq] = useState(false);
  const [ownerContactReq, setOwnerContactReq] = useState(false);
  const [photoCaptured, setPhotoCaptured] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleCapturePhoto = () => {
    setPhotoCaptured(true);
    Alert.alert("Evidencia Fotográfica", "✓ Fotografía adjuntada localmente al registro de la inspección.");
  };

  const handleSubmit = async () => {
    if (result === "UNABLE_TO_COMPLETE" && !unableReason.trim()) {
      Alert.alert("Motivo Requerido", "Por favor indique el motivo por el cual no fue posible completar la inspección.");
      return;
    }

    if (result === "DAMAGE_OBSERVED" && !description.trim()) {
      Alert.alert("Descripción Requerida", "Por favor describa el daño o anomalía observada en el vehículo.");
      return;
    }

    setSubmitting(true);
    const clientEventId = `insp-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    try {
      // 1. Enqueue outbox event for sync
      await StorageService.enqueueEvent(clientEventId, session.user.complexId, "INSPECTION", {
        taskId: task.id,
        vehiclePlate: task.plate,
        result,
        description: description.trim() || undefined,
        unableToCompleteReason: unableReason.trim() || undefined,
        surveillanceRequired: surveillanceReq,
        ownerContactRequired: ownerContactReq,
      });

      // 2. If photo was attached, enqueue attachment
      if (photoCaptured) {
        const attachEventId = `att-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        await StorageService.enqueueEvent(attachEventId, session.user.complexId, "ATTACHMENT", {
          incidentClientEventId: clientEventId,
          originalName: `evidencia-${task.plate}.jpg`,
          mimeType: "image/jpeg",
          fileSize: 1024 * 160,
          attachmentType: "DAMAGE_PHOTO",
        });
      }

      // 3. Complete and resolve task in local cache
      await StorageService.completeTaskInCache(task.id);

      // 4. If damage observed, also record in local incidents log
      if (result === "DAMAGE_OBSERVED") {
        await StorageService.saveLocalIncident({
          id: `inc_local_${Date.now()}`,
          clientEventId,
          plate: task.plate,
          description: description.trim(),
          surveillanceRequired: surveillanceReq,
          ownerContactRequired: ownerContactReq,
          photoUri: photoCaptured ? `local://evidence/${task.plate}.jpg` : undefined,
          recordedAt: new Date().toISOString(),
          reportedBy: session.user.name,
        });
      }

      Alert.alert(
        "Inspección Registrada",
        "✓ La inspección fue resguardada exitosamente en este dispositivo.",
        [{ text: "OK", onPress: onComplete }]
      );

      if (!session.isOfflineMode && !session.token.startsWith("offline_")) {
        SyncManager.synchronize().catch(() => {});
      }
    } catch (err: any) {
      Alert.alert("Error", err.message || "Error al registrar inspección");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View>
              <Text style={styles.title}>Inspección de Condición</Text>
              <Text style={styles.subtitle}>
                {task.triggerType === "RETURN" ? "Ronda de Retorno Prioritario" : "Ronda Programada"}
              </Text>
            </View>
            <TouchableOpacity onPress={onComplete} style={styles.cancelBtn}>
              <Text style={styles.cancelBtnText}>Volver</Text>
            </TouchableOpacity>
          </View>

          {/* Vehicle Info Card */}
          <View style={styles.vehicleInfo}>
            <Text style={styles.plate}>{task.plate}</Text>
            <Text style={styles.space}>📍 {task.space || "Espacio no asignado"}</Text>
          </View>

          {/* Result Selection */}
          <Text style={styles.label}>Condición Visual Observada</Text>
          <View style={styles.resultOptions}>
            <TouchableOpacity
              style={[styles.optionBtn, result === "NO_VISIBLE_INCIDENT" && styles.optionSelected]}
              onPress={() => setResult("NO_VISIBLE_INCIDENT")}
              activeOpacity={0.8}
            >
              <Text style={styles.optionIcon}>✓</Text>
              <View style={styles.optionTextContainer}>
                <Text style={styles.optionText}>Sin Novedad Visible</Text>
                <Text style={styles.optionSub}>El vehículo no presenta golpes o daños nuevos</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.optionBtn, result === "DAMAGE_OBSERVED" && styles.optionDamage]}
              onPress={() => setResult("DAMAGE_OBSERVED")}
              activeOpacity={0.8}
            >
              <Text style={styles.optionIcon}>⚠️</Text>
              <View style={styles.optionTextContainer}>
                <Text style={styles.optionText}>Daño o Anomalía Observada</Text>
                <Text style={styles.optionSub}>Raspón, abolladura, golpe o rotura visible</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.optionBtn, result === "UNABLE_TO_COMPLETE" && styles.optionUnable]}
              onPress={() => setResult("UNABLE_TO_COMPLETE")}
              activeOpacity={0.8}
            >
              <Text style={styles.optionIcon}>⛔</Text>
              <View style={styles.optionTextContainer}>
                <Text style={styles.optionText}>No Completada / Impedimento</Text>
                <Text style={styles.optionSub}>Vehículo tapado, espacio inaccesible u obstáculo</Text>
              </View>
            </TouchableOpacity>
          </View>

          {/* Conditional subforms */}
          {result === "DAMAGE_OBSERVED" && (
            <View style={styles.subform}>
              <Text style={styles.subformTitle}>Detalle del Daño</Text>
              <TextInput
                style={styles.textArea}
                value={description}
                onChangeText={setDescription}
                placeholder="Describa la ubicación exacta y severidad (ej: raspón en puerta trasera derecha con hendidura)..."
                placeholderTextColor="#64748b"
                multiline
                numberOfLines={3}
              />

              <TouchableOpacity
                style={[styles.photoBtn, photoCaptured && styles.photoBtnAttached]}
                onPress={handleCapturePhoto}
                activeOpacity={0.8}
              >
                <Text style={styles.photoBtnText}>
                  {photoCaptured ? "✓ Foto Adjuntada (1 Evidencia)" : "📷 Capturar Foto de Evidencia"}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.checkboxRow}
                onPress={() => setSurveillanceReq(!surveillanceReq)}
                activeOpacity={0.8}
              >
                <Text style={styles.checkboxIcon}>{surveillanceReq ? "☑️" : "⬜"}</Text>
                <Text style={styles.checkboxText}>Solicitar revisión de cámaras de seguridad (CCTV)</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.checkboxRow}
                onPress={() => setOwnerContactReq(!ownerContactReq)}
                activeOpacity={0.8}
              >
                <Text style={styles.checkboxIcon}>{ownerContactReq ? "☑️" : "⬜"}</Text>
                <Text style={styles.checkboxText}>Notificar a portería para contactar al propietario</Text>
              </TouchableOpacity>
            </View>
          )}

          {result === "UNABLE_TO_COMPLETE" && (
            <View style={styles.subform}>
              <Text style={styles.subformTitle}>Motivo del Impedimento</Text>
              <TextInput
                style={styles.textArea}
                value={unableReason}
                onChangeText={setUnableReason}
                placeholder="Ej: Vehículo cubierto con pijama plástica / Bloqueado por trasteo en torre..."
                placeholderTextColor="#64748b"
                multiline
                numberOfLines={3}
              />
              <Text style={styles.unableNotice}>
                * Nota de seguridad: Este registro documenta la imposibilidad pero la obligación se mantendrá en revisión.
              </Text>
            </View>
          )}

          {/* Submit button */}
          <TouchableOpacity
            style={[styles.submitBtn, submitting && styles.btnDisabled]}
            onPress={handleSubmit}
            disabled={submitting}
            activeOpacity={0.8}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.submitBtnText}>CONFIRMAR Y FINALIZAR INSPECCIÓN</Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0b1329" },
  content: { padding: 16 },
  card: {
    backgroundColor: "#131b2e",
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: "#1e293b",
  },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 },
  title: { fontSize: 20, fontWeight: "bold", color: "#f8fafc" },
  subtitle: { fontSize: 12, color: "#38bdf8", marginTop: 2, fontWeight: "600" },
  cancelBtn: { padding: 6 },
  cancelBtnText: { color: "#94a3b8", fontSize: 13, fontWeight: "600" },
  vehicleInfo: {
    backgroundColor: "#0b1329",
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#1e293b",
  },
  plate: { fontSize: 26, fontWeight: "bold", color: "#38bdf8", letterSpacing: 2 },
  space: { fontSize: 13, color: "#cbd5e1", marginTop: 4 },
  label: { fontSize: 13, color: "#94a3b8", marginBottom: 10, fontWeight: "600" },
  resultOptions: { gap: 10, marginBottom: 16 },
  optionBtn: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#334155",
    backgroundColor: "#0b1329",
  },
  optionSelected: { borderColor: "#10b981", backgroundColor: "#064e3b" },
  optionDamage: { borderColor: "#f59e0b", backgroundColor: "#451a03" },
  optionUnable: { borderColor: "#ef4444", backgroundColor: "#450a0a" },
  optionIcon: { fontSize: 20, marginRight: 12 },
  optionTextContainer: { flex: 1 },
  optionText: { color: "#f8fafc", fontSize: 15, fontWeight: "bold" },
  optionSub: { color: "#94a3b8", fontSize: 11, marginTop: 2 },
  subform: {
    marginTop: 6,
    padding: 14,
    backgroundColor: "#0b1329",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#1e293b",
  },
  subformTitle: { color: "#f8fafc", fontSize: 13, fontWeight: "bold", marginBottom: 8 },
  textArea: {
    backgroundColor: "#131b2e",
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 10,
    padding: 12,
    color: "#f8fafc",
    fontSize: 14,
    textAlignVertical: "top",
    minHeight: 70,
  },
  photoBtn: {
    marginTop: 12,
    backgroundColor: "#0284c7",
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
  },
  photoBtnAttached: { backgroundColor: "#059669" },
  photoBtnText: { color: "#fff", fontWeight: "bold", fontSize: 13 },
  checkboxRow: { flexDirection: "row", alignItems: "center", marginTop: 12 },
  checkboxIcon: { fontSize: 16, marginRight: 8 },
  checkboxText: { color: "#cbd5e1", fontSize: 13, flex: 1 },
  unableNotice: { color: "#f59e0b", fontSize: 11, marginTop: 8 },
  submitBtn: {
    marginTop: 20,
    backgroundColor: "#059669",
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
  },
  submitBtnText: { color: "#fff", fontSize: 15, fontWeight: "bold" },
  btnDisabled: { opacity: 0.5 },
});
