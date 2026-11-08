// ParkCheck Mobile - Flujo de Rondas e Inspección Vehicular (es-CO)
// Workflow: Identificar Vehículo (Cámara / Búsqueda / Cola) -> Ver Obligaciones e Historial
// -> Ejecutar Inspección (Sin novedad / Con novedad / No posible) -> Persistir y auditar
// Specification Reference: Section 3, 5, 6, 7

import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Alert,
  Modal,
  ScrollView,
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { StorageService } from "../services/storage";
import { SyncManager } from "../services/syncManager";
import { OcrService, RecognizedPlateResult } from "../services/ocrService";
import { PlateCameraModal } from "../components/PlateCameraModal";
import { PhotoCaptureModal } from "../components/PhotoCaptureModal";
import { normalizePlate } from "../../../src/domain/plateService";
import { AuthSession, CachedVehicle, CachedTask } from "../types/outbox";

interface Props {
  session: AuthSession;
}

export function RondasScreen({ session }: Props) {
  // Search & Camera identification state
  const [searchQuery, setSearchQuery] = useState("");
  const [cameraModalVisible, setCameraModalVisible] = useState(false);
  const [photoModalVisible, setPhotoModalVisible] = useState(false);
  const [identifiedVehicle, setIdentifiedVehicle] = useState<CachedVehicle | null>(null);

  // Queue state
  const [tasks, setTasks] = useState<any[]>([]);
  const [loadingQueue, setLoadingQueue] = useState(false);

  // Inspection execution modal state
  const [inspectModalVisible, setInspectModalVisible] = useState(false);
  const [activeTask, setActiveTask] = useState<{
    id: string;
    plate: string;
    space?: string;
    triggerType: string;
    description?: string;
  } | null>(null);

  // Inspection Form State
  const [inspResult, setInspResult] = useState<
    "NO_VISIBLE_INCIDENT" | "DAMAGE_OBSERVED" | "UNABLE_TO_COMPLETE"
  >("NO_VISIBLE_INCIDENT");
  const [inspDescription, setInspDescription] = useState("");
  const [unableReason, setUnableReason] = useState("");
  const [cctvReq, setCctvReq] = useState(false);
  const [ownerNoticeReq, setOwnerNoticeReq] = useState(false);
  const [capturedPhotoUri, setCapturedPhotoUri] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [lastFeedback, setLastFeedback] = useState<string | null>(null);

  const loadQueue = async () => {
    setLoadingQueue(true);
    try {
      const vehicles = await StorageService.getCachedVehicles();
      const extracted: any[] = [];
      const now = new Date();

      for (const v of vehicles) {
        if (Array.isArray(v.activeTasks) && v.activeTasks.length > 0) {
          for (const t of v.activeTasks) {
            const isDuePassed = new Date(t.dueAt).getTime() < now.getTime();
            const isOverdue = t.status === "OVERDUE" || (t.status === "PENDING" && isDuePassed);

            // Priority: Return inspections (1) -> Overdue (2) -> Routine (3)
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
              vehicleRef: v,
            });
          }
        }
      }

      // Sort deterministically
      extracted.sort((a, b) => a.priorityBucket - b.priorityBucket);
      setTasks(extracted);
    } finally {
      setLoadingQueue(false);
    }
  };

  useEffect(() => {
    loadQueue();
  }, []);

  // Handle identification from real camera scan
  const handlePlateDetected = async (ocrResult: RecognizedPlateResult) => {
    const clean = ocrResult.selectedPlate;
    const vehicle = await StorageService.ensureVehicleInCache(clean);
    setIdentifiedVehicle(vehicle);
    setSearchQuery(clean);
  };

  // Handle text search
  const handleSearchChange = async (text: string) => {
    setSearchQuery(text);
    const clean = normalizePlate(text);
    if (clean.length >= 3) {
      const vehicle = await StorageService.getVehicleByPlate(clean);
      setIdentifiedVehicle(vehicle);
    } else {
      setIdentifiedVehicle(null);
    }
  };

  // Open inspection execution
  const openInspection = (task: any, vehicle?: CachedVehicle) => {
    setActiveTask({
      id: task.id,
      plate: task.plate,
      space: task.space || vehicle?.parkingSpace || undefined,
      triggerType: task.triggerType,
      description: task.description,
    });
    setInspResult("NO_VISIBLE_INCIDENT");
    setInspDescription("");
    setUnableReason("");
    setCctvReq(false);
    setOwnerNoticeReq(false);
    setCapturedPhotoUri(null);
    setInspectModalVisible(true);
  };

  // Start ad-hoc inspection if vehicle has no pending task
  const handleStartAdHocInspection = async (vehicle: CachedVehicle) => {
    const newTask = await StorageService.createTaskForVehicle(
      vehicle.plate,
      "SCHEDULED",
      "Ronda rutinaria iniciada en terreno"
    );
    // Reload vehicle and queue
    const updated = await StorageService.getVehicleByPlate(vehicle.plate);
    setIdentifiedVehicle(updated);
    await loadQueue();
    openInspection({ ...newTask, plate: vehicle.plate, space: vehicle.parkingSpace }, updated || undefined);
  };

  // Submit Inspection
  const handleSubmitInspection = async () => {
    if (!activeTask) return;

    if (inspResult === "UNABLE_TO_COMPLETE" && !unableReason.trim()) {
      Alert.alert(
        "Motivo Obligatorio",
        "Por favor especifique por qué no fue posible realizar la inspección."
      );
      return;
    }

    if (inspResult === "DAMAGE_OBSERVED" && !inspDescription.trim()) {
      Alert.alert(
        "Descripción Obligatoria",
        "Por favor describa el daño o anomalía observada en el vehículo."
      );
      return;
    }

    setSubmitting(true);
    const clientEventId = `insp-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    try {
      // 1. Enqueue outbox event for sync
      await StorageService.enqueueEvent(clientEventId, session.user.complexId, "INSPECTION", {
        taskId: activeTask.id,
        vehiclePlate: activeTask.plate,
        result: inspResult,
        description: inspDescription.trim() || undefined,
        unableToCompleteReason: unableReason.trim() || undefined,
        surveillanceRequired: cctvReq,
        ownerContactRequired: ownerNoticeReq,
        photoUri: capturedPhotoUri || undefined,
      });

      // 2. If photo was attached, enqueue attachment outbox event
      if (capturedPhotoUri) {
        const attachId = `att-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        await StorageService.enqueueEvent(attachId, session.user.complexId, "ATTACHMENT", {
          incidentClientEventId: clientEventId,
          originalName: `evidencia-${activeTask.plate}.jpg`,
          mimeType: "image/jpeg",
          fileUri: capturedPhotoUri,
          attachmentType: "DAMAGE_PHOTO",
        });
      }

      // 3. Complete and resolve task in cache (removes from active queue, records in completed history)
      await StorageService.completeTaskInCache(activeTask.id, {
        result: inspResult,
        description: inspDescription.trim() || undefined,
        unableReason: unableReason.trim() || undefined,
      });

      // 4. If damage observed, record in local incidents log
      if (inspResult === "DAMAGE_OBSERVED") {
        await StorageService.saveLocalIncident({
          id: `inc_local_${Date.now()}`,
          clientEventId,
          plate: activeTask.plate,
          category: "DAÑO_EN_RONDA",
          description: inspDescription.trim(),
          surveillanceRequired: cctvReq,
          ownerContactRequired: ownerNoticeReq,
          photoUri: capturedPhotoUri || undefined,
          recordedAt: new Date().toISOString(),
          reportedBy: session.user.name,
        });
      }

      setInspectModalVisible(false);
      const isOffline = session.isOfflineMode || session.token.startsWith("offline_");
      const persistenceText = isOffline
        ? "Guardado localmente (pendiente de sincronización)"
        : "Registrado y sincronizando";

      const outcomeText =
        inspResult === "NO_VISIBLE_INCIDENT"
          ? "Sin novedad"
          : inspResult === "DAMAGE_OBSERVED"
          ? "Con novedad (daño registrado)"
          : "No realizada (impedimento)";

      setLastFeedback(`✓ Ronda registrada para ${activeTask.plate}: ${outcomeText}\n${persistenceText}`);

      // Refresh vehicle view & queue
      if (identifiedVehicle) {
        const refreshed = await StorageService.getVehicleByPlate(identifiedVehicle.plate);
        setIdentifiedVehicle(refreshed);
      }
      await loadQueue();

      if (!isOffline) {
        SyncManager.synchronize().catch(() => {});
      }
    } catch (err: any) {
      Alert.alert("Error", err.message || "Error al registrar la inspección.");
    } finally {
      setSubmitting(false);
    }
  };

  // Render individual task in queue
  const renderQueueItem = ({ item }: { item: any }) => {
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
            <Text style={styles.cardPlate}>{item.plate}</Text>
            <Text style={styles.cardSpace}>📍 {item.space}</Text>
          </View>

          <View style={styles.badgeRow}>
            <View
              style={[
                styles.badge,
                isReturn
                  ? styles.badgeReturn
                  : isOverdue
                  ? styles.badgeOverdue
                  : styles.badgeNormal,
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
          <Text style={styles.taskDesc}>{item.description}</Text>
        ) : null}

        {item.isVehicleAway ? (
          <View style={styles.awayNoticeBox}>
            <Text style={styles.awayNoticeText}>
              Vehículo fuera de las instalaciones. Obligación preservada en historial.
            </Text>
          </View>
        ) : null}

        <TouchableOpacity
          style={styles.inspectActionBtn}
          onPress={() => openInspection(item, item.vehicleRef)}
          activeOpacity={0.8}
        >
          <Text style={styles.inspectActionBtnText}>INSPECCIONAR VEHÍCULO</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Search & Identification Header */}
      <View style={styles.searchHeader}>
        <Text style={styles.sectionTitle}>Rondas e Inspecciones de Vehículos</Text>

        {lastFeedback && (
          <View style={styles.feedbackBanner}>
            <Text style={styles.feedbackText}>{lastFeedback}</Text>
          </View>
        )}

        {/* Plate Search Row with Camera Scan */}
        <View style={styles.searchRow}>
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={handleSearchChange}
            placeholder="Buscar por placa (ej: KHY842)..."
            placeholderTextColor="#6b7280"
            autoCapitalize="characters"
          />

          <TouchableOpacity
            style={styles.cameraScanBtn}
            onPress={() => setCameraModalVisible(true)}
            activeOpacity={0.8}
          >
            <Text style={styles.cameraScanIcon}>📷</Text>
            <Text style={styles.cameraScanText}>Escanear</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* IDENTIFIED VEHICLE CARD (if searched or scanned) */}
        {identifiedVehicle && (
          <View style={styles.identifiedCard}>
            <View style={styles.identifiedHeader}>
              <View>
                <Text style={styles.identifiedPlate}>{identifiedVehicle.plate}</Text>
                {identifiedVehicle.make ? (
                  <Text style={styles.identifiedDetails}>
                    {identifiedVehicle.make} {identifiedVehicle.model || ""} {identifiedVehicle.color || ""}
                  </Text>
                ) : null}
                <Text style={styles.identifiedSpace}>
                  📍 Espacio: {identifiedVehicle.parkingSpace || "Sin espacio asignado"}
                </Text>
              </View>

              <View
                style={[
                  styles.presenceTag,
                  identifiedVehicle.presenceStatus === "INSIDE"
                    ? styles.tagInside
                    : styles.tagAway,
                ]}
              >
                <Text style={styles.presenceTagText}>
                  {identifiedVehicle.presenceStatus === "INSIDE" ? "DENTRO" : "FUERA"}
                </Text>
              </View>
            </View>

            {/* Obligations Section */}
            <Text style={styles.obligationsTitle}>Obligaciones de Inspección:</Text>
            {identifiedVehicle.activeTasks && identifiedVehicle.activeTasks.length > 0 ? (
              identifiedVehicle.activeTasks.map((t) => (
                <View key={t.id} style={styles.obligationItem}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.obligationType}>
                      {t.triggerType === "RETURN" ? "⚡ Retorno Prioritario" : "📋 Ronda Programada"}
                    </Text>
                    <Text style={styles.obligationDetail}>
                      {t.description || "Inspección pendiente"}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.inspectMiniBtn}
                    onPress={() =>
                      openInspection(
                        { ...t, plate: identifiedVehicle.plate, space: identifiedVehicle.parkingSpace },
                        identifiedVehicle
                      )
                    }
                    activeOpacity={0.8}
                  >
                    <Text style={styles.inspectMiniText}>Inspeccionar</Text>
                  </TouchableOpacity>
                </View>
              ))
            ) : (
              <View style={styles.noTasksBox}>
                <Text style={styles.noTasksText}>
                  Sin rondas pendientes programadas para este vehículo.
                </Text>
                <TouchableOpacity
                  style={styles.adHocBtn}
                  onPress={() => handleStartAdHocInspection(identifiedVehicle)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.adHocBtnText}>+ Iniciar Ronda Extraordinaria</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Previous inspection history if available */}
            {identifiedVehicle.completedTasks && identifiedVehicle.completedTasks.length > 0 && (
              <View style={styles.historySection}>
                <Text style={styles.historyTitle}>Historial de Rondas Recientes:</Text>
                {identifiedVehicle.completedTasks.slice(0, 3).map((h, i) => (
                  <Text key={i} style={styles.historyItemText}>
                    • {new Date(h.completedAt || "").toLocaleDateString([], { month: "short", day: "numeric" })} -{" "}
                    {h.outcomeResult === "NO_VISIBLE_INCIDENT"
                      ? "Sin novedad"
                      : h.outcomeResult === "DAMAGE_OBSERVED"
                      ? `Daño: ${h.description || "Reportado"}`
                      : `No realizada: ${h.unableReason || ""}`}
                  </Text>
                ))}
              </View>
            )}
          </View>
        )}

        {/* GENERAL PRIORITIZED INSPECTION QUEUE */}
        <View style={styles.queueHeaderRow}>
          <Text style={styles.queueTitle}>
            Cola de Rondas Priorizadas ({tasks.length})
          </Text>
          <TouchableOpacity
            style={styles.refreshQueueBtn}
            onPress={loadQueue}
            activeOpacity={0.8}
          >
            <Text style={styles.refreshQueueText}>🔄 Actualizar</Text>
          </TouchableOpacity>
        </View>

        {loadingQueue ? (
          <ActivityIndicator color="#0284c7" style={{ marginVertical: 20 }} />
        ) : tasks.length === 0 ? (
          <View style={styles.emptyQueueBox}>
            <Text style={styles.emptyQueueTitle}>✓ No hay rondas pendientes</Text>
            <Text style={styles.emptyQueueSub}>
              Todos los vehículos dentro de las instalaciones están al día.
            </Text>
          </View>
        ) : (
          tasks.map((task) => (
            <View key={task.id}>{renderQueueItem({ item: task })}</View>
          ))
        )}
      </ScrollView>

      {/* PLATE CAMERA SCANNER MODAL */}
      <PlateCameraModal
        visible={cameraModalVisible}
        onClose={() => setCameraModalVisible(false)}
        onPlateDetected={handlePlateDetected}
      />

      {/* PHOTO CAPTURE MODAL (For Damage Evidence) */}
      <PhotoCaptureModal
        visible={photoModalVisible}
        title="Fotografiar Daño del Vehículo"
        onClose={() => setPhotoModalVisible(false)}
        onPhotoCaptured={(uri) => setCapturedPhotoUri(uri)}
      />

      {/* INSPECTION EXECUTION MODAL */}
      <Modal
        visible={inspectModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setInspectModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            {/* Header */}
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>Ejecutar Inspección</Text>
                <Text style={styles.modalSubtitle}>
                  {activeTask?.plate} • {activeTask?.space || "Sin espacio"}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setInspectModalVisible(false)}
                style={styles.closeTouch}
              >
                <Text style={styles.closeBtn}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
              {/* Result Choice Buttons */}
              <Text style={styles.formSectionLabel}>Resultado de la Inspección Visual</Text>

              {/* 1. Sin Novedad */}
              <TouchableOpacity
                style={[
                  styles.resultOptionBtn,
                  inspResult === "NO_VISIBLE_INCIDENT" && styles.resultOptionSinNovedadActive,
                ]}
                onPress={() => setInspResult("NO_VISIBLE_INCIDENT")}
                activeOpacity={0.8}
              >
                <Text style={styles.resultIcon}>✓</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.resultTitle}>Sin Novedad</Text>
                  <Text style={styles.resultSub}>Vehículo en estado normal, sin daños visibles</Text>
                </View>
              </TouchableOpacity>

              {/* 2. Con Novedad */}
              <TouchableOpacity
                style={[
                  styles.resultOptionBtn,
                  inspResult === "DAMAGE_OBSERVED" && styles.resultOptionConNovedadActive,
                ]}
                onPress={() => setInspResult("DAMAGE_OBSERVED")}
                activeOpacity={0.8}
              >
                <Text style={styles.resultIcon}>⚠️</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.resultTitle}>Con Novedad / Daño Observado</Text>
                  <Text style={styles.resultSub}>Golpe, raspón, vidrio roto u otra anomalía</Text>
                </View>
              </TouchableOpacity>

              {/* 3. No fue posible realizarla */}
              <TouchableOpacity
                style={[
                  styles.resultOptionBtn,
                  inspResult === "UNABLE_TO_COMPLETE" && styles.resultOptionNoPosibleActive,
                ]}
                onPress={() => setInspResult("UNABLE_TO_COMPLETE")}
                activeOpacity={0.8}
              >
                <Text style={styles.resultIcon}>⛔</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.resultTitle}>No Fue Posible Realizarla</Text>
                  <Text style={styles.resultSub}>Vehículo tapado, espacio bloqueado o inaccesible</Text>
                </View>
              </TouchableOpacity>

              {/* Sub-form: Con Novedad */}
              {inspResult === "DAMAGE_OBSERVED" && (
                <View style={styles.subformContainer}>
                  <Text style={styles.subformLabel}>
                    Descripción del daño o anomalía (Obligatorio)
                  </Text>
                  <TextInput
                    style={styles.textArea}
                    value={inspDescription}
                    onChangeText={setInspDescription}
                    placeholder="Describa el daño observado (ej: hendidura en puerta trasera izquierda)..."
                    placeholderTextColor="#6b7280"
                    multiline
                    numberOfLines={3}
                  />

                  {/* Photo Evidence Attachment */}
                  <Text style={styles.subformLabel}>Fotografía de Evidencia</Text>
                  {capturedPhotoUri ? (
                    <View style={styles.photoAttachedBox}>
                      <Image source={{ uri: capturedPhotoUri }} style={styles.photoThumbnail} />
                      <View style={{ flex: 1, marginLeft: 10 }}>
                        <Text style={styles.photoAttachedText}>✓ Foto adjuntada</Text>
                        <TouchableOpacity
                          onPress={() => setPhotoModalVisible(true)}
                          style={styles.retakeBtn}
                        >
                          <Text style={styles.retakeBtnText}>Tomar otra foto</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={styles.takePhotoBtn}
                      onPress={() => setPhotoModalVisible(true)}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.takePhotoIcon}>📷</Text>
                      <Text style={styles.takePhotoText}>Tomar Foto del Daño</Text>
                    </TouchableOpacity>
                  )}

                  {/* Checkbox toggles */}
                  <TouchableOpacity
                    style={styles.checkboxRow}
                    onPress={() => setCctvReq(!cctvReq)}
                    activeOpacity={0.8}
                  >
                    <View style={[styles.checkbox, cctvReq && styles.checkboxActive]}>
                      {cctvReq && <Text style={styles.checkmark}>✓</Text>}
                    </View>
                    <Text style={styles.checkboxLabel}>Solicitar revisión de cámaras (CCTV)</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.checkboxRow}
                    onPress={() => setOwnerNoticeReq(!ownerNoticeReq)}
                    activeOpacity={0.8}
                  >
                    <View style={[styles.checkbox, ownerNoticeReq && styles.checkboxActive]}>
                      {ownerNoticeReq && <Text style={styles.checkmark}>✓</Text>}
                    </View>
                    <Text style={styles.checkboxLabel}>Avisar a residente / propietario</Text>
                  </TouchableOpacity>

                  <Text style={styles.disclaimerText}>
                    * El reporte registra la condición visible actual. No determina cómo ni cuándo ocurrió el daño.
                  </Text>
                </View>
              )}

              {/* Sub-form: No fue posible */}
              {inspResult === "UNABLE_TO_COMPLETE" && (
                <View style={styles.subformContainer}>
                  <Text style={styles.subformLabel}>
                    Motivo por el cual no se pudo inspeccionar (Obligatorio)
                  </Text>
                  <TextInput
                    style={styles.inputField}
                    value={unableReason}
                    onChangeText={setUnableReason}
                    placeholder="Ej: Vehículo con pijama/carpa, espacio cerrado con candado..."
                    placeholderTextColor="#6b7280"
                  />
                </View>
              )}

              {/* SUBMIT BUTTON */}
              <TouchableOpacity
                style={[styles.submitInspBtn, submitting && styles.btnDisabled]}
                onPress={handleSubmitInspection}
                disabled={submitting}
                activeOpacity={0.8}
              >
                {submitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.submitInspBtnText}>GUARDAR INSPECCIÓN</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#090d16" },
  searchHeader: {
    padding: 16,
    backgroundColor: "#111827",
    borderBottomWidth: 1,
    borderBottomColor: "#1f2937",
  },
  sectionTitle: { fontSize: 18, fontWeight: "bold", color: "#f9fafb" },
  feedbackBanner: {
    backgroundColor: "#064e3b",
    borderColor: "#059669",
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    marginTop: 10,
  },
  feedbackText: { color: "#a7f3d0", fontSize: 12, fontWeight: "600", textAlign: "center" },
  searchRow: { flexDirection: "row", gap: 10, marginTop: 12 },
  searchInput: {
    flex: 1,
    backgroundColor: "#090d16",
    borderWidth: 1,
    borderColor: "#374151",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "#f9fafb",
    fontSize: 14,
  },
  cameraScanBtn: {
    backgroundColor: "#0284c7",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    borderRadius: 8,
    gap: 6,
  },
  cameraScanIcon: { fontSize: 16 },
  cameraScanText: { color: "#fff", fontWeight: "bold", fontSize: 13 },
  scrollContent: { padding: 16, paddingBottom: 32 },

  // Identified card styles
  identifiedCard: {
    backgroundColor: "#111827",
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#0284c7",
  },
  identifiedHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  identifiedPlate: { color: "#38bdf8", fontSize: 22, fontWeight: "bold" },
  identifiedDetails: { color: "#9ca3af", fontSize: 12, marginTop: 2 },
  identifiedSpace: { color: "#d1d5db", fontSize: 13, marginTop: 4 },
  presenceTag: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  tagInside: { backgroundColor: "#059669" },
  tagAway: { backgroundColor: "#0284c7" },
  presenceTagText: { color: "#fff", fontSize: 11, fontWeight: "bold" },
  obligationsTitle: { color: "#9ca3af", fontSize: 12, fontWeight: "600", marginTop: 12, textTransform: "uppercase" },
  obligationItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#090d16",
    padding: 10,
    borderRadius: 8,
    marginTop: 6,
  },
  obligationType: { color: "#f9fafb", fontSize: 13, fontWeight: "bold" },
  obligationDetail: { color: "#9ca3af", fontSize: 11, marginTop: 2 },
  inspectMiniBtn: { backgroundColor: "#059669", paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6 },
  inspectMiniText: { color: "#fff", fontSize: 12, fontWeight: "bold" },
  noTasksBox: { paddingVertical: 8, alignItems: "center" },
  noTasksText: { color: "#6b7280", fontSize: 12 },
  adHocBtn: { marginTop: 8, backgroundColor: "#1f2937", paddingVertical: 8, paddingHorizontal: 14, borderRadius: 6 },
  adHocBtnText: { color: "#38bdf8", fontSize: 12, fontWeight: "600" },
  historySection: { marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: "#1f2937" },
  historyTitle: { color: "#6b7280", fontSize: 11, fontWeight: "600" },
  historyItemText: { color: "#9ca3af", fontSize: 11, marginTop: 2 },

  // Queue styles
  queueHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  queueTitle: { color: "#f9fafb", fontSize: 15, fontWeight: "bold" },
  refreshQueueBtn: { padding: 4 },
  refreshQueueText: { color: "#38bdf8", fontSize: 12 },
  taskCard: {
    backgroundColor: "#111827",
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#1f2937",
  },
  cardReturn: { borderColor: "#f59e0b" },
  cardOverdue: { borderColor: "#ef4444" },
  cardAway: { opacity: 0.8 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  cardPlate: { color: "#f9fafb", fontSize: 18, fontWeight: "bold" },
  cardSpace: { color: "#9ca3af", fontSize: 12, marginTop: 2 },
  badgeRow: { flexDirection: "row", gap: 6 },
  badge: { paddingHorizontal: 6, paddingVertical: 3, borderRadius: 4 },
  badgeReturn: { backgroundColor: "#78350f" },
  badgeOverdue: { backgroundColor: "#7f1d1d" },
  badgeNormal: { backgroundColor: "#1e3a8a" },
  badgeText: { color: "#fff", fontSize: 10, fontWeight: "bold" },
  badgeAwayTag: { backgroundColor: "#374151", paddingHorizontal: 6, paddingVertical: 3, borderRadius: 4 },
  badgeAwayText: { color: "#9ca3af", fontSize: 10, fontWeight: "bold" },
  taskDesc: { color: "#d1d5db", fontSize: 12, marginTop: 8 },
  awayNoticeBox: { backgroundColor: "#374151", borderRadius: 6, padding: 6, marginTop: 8 },
  awayNoticeText: { color: "#f3f4f6", fontSize: 11 },
  inspectActionBtn: {
    backgroundColor: "#059669",
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
    marginTop: 10,
  },
  inspectActionBtnText: { color: "#fff", fontSize: 13, fontWeight: "bold" },
  emptyQueueBox: { padding: 24, alignItems: "center", backgroundColor: "#111827", borderRadius: 10 },
  emptyQueueTitle: { color: "#10b981", fontSize: 15, fontWeight: "bold" },
  emptyQueueSub: { color: "#6b7280", fontSize: 12, marginTop: 4, textAlign: "center" },

  // Execution Modal styles
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.85)", justifyContent: "flex-end" },
  modalContent: {
    backgroundColor: "#111827",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 18,
    maxHeight: "92%",
    borderTopWidth: 1,
    borderTopColor: "#374151",
  },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 },
  modalTitle: { color: "#38bdf8", fontSize: 18, fontWeight: "bold" },
  modalSubtitle: { color: "#9ca3af", fontSize: 12, marginTop: 2 },
  closeTouch: { padding: 6 },
  closeBtn: { color: "#9ca3af", fontSize: 20, fontWeight: "bold" },
  formSectionLabel: { color: "#d1d5db", fontSize: 13, fontWeight: "600", marginBottom: 10 },
  resultOptionBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#090d16",
    borderWidth: 1,
    borderColor: "#374151",
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    gap: 12,
  },
  resultOptionSinNovedadActive: { borderColor: "#10b981", backgroundColor: "#064e3b" },
  resultOptionConNovedadActive: { borderColor: "#ef4444", backgroundColor: "#450a0a" },
  resultOptionNoPosibleActive: { borderColor: "#f59e0b", backgroundColor: "#451a03" },
  resultIcon: { fontSize: 20 },
  resultTitle: { color: "#f9fafb", fontSize: 14, fontWeight: "bold" },
  resultSub: { color: "#9ca3af", fontSize: 11, marginTop: 2 },
  subformContainer: {
    backgroundColor: "#090d16",
    borderRadius: 8,
    padding: 12,
    marginVertical: 10,
    borderWidth: 1,
    borderColor: "#1f2937",
  },
  subformLabel: { color: "#d1d5db", fontSize: 12, fontWeight: "600", marginBottom: 6, marginTop: 6 },
  textArea: {
    backgroundColor: "#111827",
    borderWidth: 1,
    borderColor: "#374151",
    borderRadius: 8,
    padding: 10,
    color: "#f9fafb",
    fontSize: 13,
  },
  inputField: {
    backgroundColor: "#111827",
    borderWidth: 1,
    borderColor: "#374151",
    borderRadius: 8,
    padding: 10,
    color: "#f9fafb",
    fontSize: 13,
  },
  takePhotoBtn: {
    backgroundColor: "#1f2937",
    borderWidth: 1,
    borderColor: "#0284c7",
    borderStyle: "dashed",
    borderRadius: 8,
    padding: 14,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    marginVertical: 6,
  },
  takePhotoIcon: { fontSize: 20 },
  takePhotoText: { color: "#38bdf8", fontSize: 13, fontWeight: "600" },
  photoAttachedBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#111827",
    padding: 8,
    borderRadius: 8,
    marginVertical: 6,
  },
  photoThumbnail: { width: 64, height: 64, borderRadius: 6, backgroundColor: "#000" },
  photoAttachedText: { color: "#10b981", fontSize: 13, fontWeight: "bold" },
  retakeBtn: { marginTop: 4 },
  retakeBtnText: { color: "#38bdf8", fontSize: 12 },
  checkboxRow: { flexDirection: "row", alignItems: "center", marginTop: 10, gap: 10 },
  checkbox: {
    width: 20,
    height: 20,
    borderWidth: 2,
    borderColor: "#4b5563",
    borderRadius: 4,
    justifyContent: "center",
    alignItems: "center",
  },
  checkboxActive: { borderColor: "#0284c7", backgroundColor: "#0284c7" },
  checkmark: { color: "#fff", fontSize: 12, fontWeight: "bold" },
  checkboxLabel: { color: "#d1d5db", fontSize: 12 },
  disclaimerText: { color: "#6b7280", fontSize: 11, marginTop: 12, fontStyle: "italic" },
  submitInspBtn: {
    backgroundColor: "#059669",
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 16,
  },
  submitInspBtnText: { color: "#fff", fontSize: 15, fontWeight: "bold" },
  btnDisabled: { opacity: 0.5 },
});
