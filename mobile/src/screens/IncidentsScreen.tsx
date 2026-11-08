// ParkCheck Mobile - Reporte de Novedades e Incidentes (es-CO)
// Workflow: 1. Identificar Vehículo (Cámara / Manual) -> 2. Categoría y Descripción
// -> 3. Foto de Evidencia Real -> 4. Guardar y Auditar en Turno
// Specification Reference: Section 4, 5, 6, 7

import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
  FlatList,
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { StorageService } from "../services/storage";
import { SyncManager } from "../services/syncManager";
import { PlateCameraModal } from "../components/PlateCameraModal";
import { PhotoCaptureModal } from "../components/PhotoCaptureModal";
import { normalizePlate, validatePlateFormat } from "../../../src/domain/plateService";
import { AuthSession, LocalIncidentRecord, CachedVehicle } from "../types/outbox";

interface Props {
  session: AuthSession;
}

const INCIDENT_CATEGORIES = [
  { id: "GOLPE_ABOLLADURA", label: "Golpe o abolladura", icon: "💥" },
  { id: "RASPON_PINTURA", label: "Raspón o rayón", icon: "⚡" },
  { id: "VIDRIO_ESPEJO", label: "Vidrio o espejo roto", icon: "🪞" },
  { id: "LUCES_ENCENDIDAS", label: "Luces encendidas", icon: "💡" },
  { id: "VENTANA_ABIERTA", label: "Ventana abierta / sin seguro", icon: "🚪" },
  { id: "ALARMA_ACTIVADA", label: "Alarma sonora activada", icon: "🚨" },
  { id: "DERRAME_FLUIDOS", label: "Fuga o derrame de fluidos", icon: "💧" },
  { id: "OTRO", label: "Otra novedad", icon: "📝" },
];

export function IncidentsScreen({ session }: Props) {
  const [activeTab, setActiveTab] = useState<"report" | "history">("report");

  // Step 1: Vehicle identification
  const [plateInput, setPlateInput] = useState("");
  const [identifiedVehicle, setIdentifiedVehicle] = useState<CachedVehicle | null>(null);
  const [cameraModalVisible, setCameraModalVisible] = useState(false);

  // Step 2: Incident Form
  const [category, setCategory] = useState("GOLPE_ABOLLADURA");
  const [description, setDescription] = useState("");
  const [photoModalVisible, setPhotoModalVisible] = useState(false);
  const [capturedPhotoUri, setCapturedPhotoUri] = useState<string | null>(null);
  const [cctvReq, setCctvReq] = useState(false);
  const [ownerNoticeReq, setOwnerNoticeReq] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Shift History
  const [historyList, setHistoryList] = useState<LocalIncidentRecord[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const loadHistory = async () => {
    setLoadingHistory(true);
    try {
      const records = await StorageService.getLocalIncidents();
      setHistoryList(records);
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    loadHistory();
  }, []);

  const handlePlateChange = async (text: string) => {
    const clean = normalizePlate(text);
    setPlateInput(clean);

    if (clean.length >= 3) {
      const vehicle = await StorageService.getVehicleByPlate(clean);
      setIdentifiedVehicle(vehicle);
    } else {
      setIdentifiedVehicle(null);
    }
  };

  const handleCameraPlateDetected = async (result: any) => {
    const clean = result.selectedPlate;
    setPlateInput(clean);
    const vehicle = await StorageService.ensureVehicleInCache(clean);
    setIdentifiedVehicle(vehicle);
  };

  const handleSubmit = async () => {
    const val = validatePlateFormat(plateInput);
    if (!val.isValid) {
      Alert.alert("Placa Requerida", val.error || "Ingrese una placa válida.");
      return;
    }

    if (!description.trim()) {
      Alert.alert(
        "Descripción Requerida",
        "Por favor describa con claridad lo observado en el vehículo."
      );
      return;
    }

    setSubmitting(true);
    const clientEventId = `inc-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    try {
      // 1. Ensure vehicle entity in shared cache
      await StorageService.ensureVehicleInCache(val.normalizedPlate);

      // 2. Enqueue outbox event
      await StorageService.enqueueEvent(clientEventId, session.user.complexId, "INCIDENT", {
        vehiclePlate: val.normalizedPlate,
        category,
        description: description.trim(),
        surveillanceRequired: cctvReq,
        ownerContactRequired: ownerNoticeReq,
        photoUri: capturedPhotoUri || undefined,
      });

      // 3. Enqueue attachment if photo attached
      if (capturedPhotoUri) {
        const attachId = `att-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        await StorageService.enqueueEvent(attachId, session.user.complexId, "ATTACHMENT", {
          incidentClientEventId: clientEventId,
          originalName: `novedad-${val.normalizedPlate}.jpg`,
          mimeType: "image/jpeg",
          fileUri: capturedPhotoUri,
          attachmentType: "DAMAGE_PHOTO",
        });
      }

      // 4. Save into local persistent shift log
      const localRecord: LocalIncidentRecord = {
        id: `inc_local_${Date.now()}`,
        clientEventId,
        plate: val.normalizedPlate,
        category,
        description: description.trim(),
        surveillanceRequired: cctvReq,
        ownerContactRequired: ownerNoticeReq,
        photoUri: capturedPhotoUri || undefined,
        recordedAt: new Date().toISOString(),
        reportedBy: session.user.name,
      };

      await StorageService.saveLocalIncident(localRecord);

      const isOffline = session.isOfflineMode || session.token.startsWith("offline_");
      const persistenceMsg = isOffline
        ? "Guardado localmente en este dispositivo (pendiente de sincronización)"
        : "Registrado y en sincronización con el servidor";

      setFeedback(`✓ Novedad registrada para ${val.normalizedPlate}\n${persistenceMsg}`);

      // Reset form
      setPlateInput("");
      setIdentifiedVehicle(null);
      setDescription("");
      setCapturedPhotoUri(null);
      setCctvReq(false);
      setOwnerNoticeReq(false);

      await loadHistory();
      setActiveTab("history");

      if (!isOffline) {
        SyncManager.synchronize().catch(() => {});
      }
    } catch (err: any) {
      Alert.alert("Error", err.message || "Error al registrar la novedad.");
    } finally {
      setSubmitting(false);
    }
  };

  const renderHistoryItem = ({ item }: { item: LocalIncidentRecord }) => {
    const cat = INCIDENT_CATEGORIES.find((c) => c.id === item.category);

    return (
      <View style={styles.historyCard}>
        <View style={styles.historyHeader}>
          <View>
            <Text style={styles.cardPlate}>{item.plate}</Text>
            <Text style={styles.categoryBadge}>
              {cat?.icon || "⚠️"} {cat?.label || item.category || "Novedad"}
            </Text>
          </View>
          <Text style={styles.cardTime}>
            {new Date(item.recordedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </Text>
        </View>

        <Text style={styles.cardDesc}>{item.description}</Text>

        {item.photoUri ? (
          <View style={styles.historyPhotoRow}>
            <Image source={{ uri: item.photoUri }} style={styles.historyThumbnail} />
            <Text style={styles.photoTagText}>📷 Evidencia fotográfica adjuntada</Text>
          </View>
        ) : null}

        <View style={styles.tagRow}>
          {item.surveillanceRequired && (
            <View style={styles.cctvTag}>
              <Text style={styles.tagText}>CCTV Solicitado</Text>
            </View>
          )}

          {item.ownerContactRequired && (
            <View style={styles.ownerTag}>
              <Text style={styles.tagText}>Aviso Residente</Text>
            </View>
          )}
        </View>

        <Text style={styles.reporterText}>Por: {item.reportedBy}</Text>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.container}
    >
      {/* Top Tab Bar: Reportar vs Historial */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tabBtn, activeTab === "report" && styles.tabBtnActive]}
          onPress={() => setActiveTab("report")}
          activeOpacity={0.8}
        >
          <Text style={[styles.tabText, activeTab === "report" && styles.tabTextActive]}>
            📝 Reportar Novedad
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabBtn, activeTab === "history" && styles.tabBtnActive]}
          onPress={() => {
            loadHistory();
            setActiveTab("history");
          }}
          activeOpacity={0.8}
        >
          <Text style={[styles.tabText, activeTab === "history" && styles.tabTextActive]}>
            📋 Historial Turno ({historyList.length})
          </Text>
        </TouchableOpacity>
      </View>

      {feedback && (
        <View style={styles.feedbackBanner}>
          <Text style={styles.feedbackText}>{feedback}</Text>
        </View>
      )}

      {activeTab === "report" ? (
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Paso 1: Identificar Vehículo</Text>
            <Text style={styles.cardSub}>
              Escanee la placa con la cámara o digítela para asociar la novedad:
            </Text>

            <View style={styles.identifyRow}>
              <TextInput
                style={styles.plateInput}
                value={plateInput}
                onChangeText={handlePlateChange}
                placeholder="EJ: KHY842"
                placeholderTextColor="#6b7280"
                autoCapitalize="characters"
                maxLength={8}
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

            {/* Identified Vehicle Summary */}
            {identifiedVehicle && (
              <View style={styles.vehicleSummaryBox}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.summaryPlate}>{identifiedVehicle.plate}</Text>
                  {identifiedVehicle.make ? (
                    <Text style={styles.summaryDetails}>
                      {identifiedVehicle.make} {identifiedVehicle.model || ""} {identifiedVehicle.color || ""}
                    </Text>
                  ) : null}
                  <Text style={styles.summarySpace}>
                    📍 Espacio: {identifiedVehicle.parkingSpace || "Sin espacio asignado"}
                  </Text>
                </View>

                <View
                  style={[
                    styles.presenceBadge,
                    identifiedVehicle.presenceStatus === "INSIDE"
                      ? styles.badgeInside
                      : styles.badgeAway,
                  ]}
                >
                  <Text style={styles.presenceText}>
                    {identifiedVehicle.presenceStatus === "INSIDE" ? "DENTRO" : "FUERA"}
                  </Text>
                </View>
              </View>
            )}

            {/* Step 2: Form */}
            <Text style={[styles.cardTitle, { marginTop: 20 }]}>Paso 2: Detalles de la Novedad</Text>

            {/* Category Grid */}
            <Text style={styles.fieldLabel}>Tipo de Novedad u Observación</Text>
            <View style={styles.categoryGrid}>
              {INCIDENT_CATEGORIES.map((cat) => (
                <TouchableOpacity
                  key={cat.id}
                  style={[
                    styles.catChip,
                    category === cat.id && styles.catChipActive,
                  ]}
                  onPress={() => setCategory(cat.id)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.catIcon}>{cat.icon}</Text>
                  <Text style={[styles.catText, category === cat.id && styles.catTextActive]}>
                    {cat.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Description */}
            <Text style={styles.fieldLabel}>Descripción de lo Observado (Obligatorio)</Text>
            <TextInput
              style={styles.textArea}
              value={description}
              onChangeText={setDescription}
              placeholder="Describa objetivamente lo observado (ej: vehículo con vidrio del conductor entreabierto 10 cm)..."
              placeholderTextColor="#6b7280"
              multiline
              numberOfLines={3}
            />

            {/* Evidence Photo */}
            <Text style={styles.fieldLabel}>Evidencia Fotográfica (Opcional según tipo)</Text>
            {capturedPhotoUri ? (
              <View style={styles.photoAttachedBox}>
                <Image source={{ uri: capturedPhotoUri }} style={styles.photoThumbnail} />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.photoAttachedText}>✓ Fotografía adjuntada</Text>
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
                <Text style={styles.takePhotoText}>Tomar Fotografía con Cámara</Text>
              </TouchableOpacity>
            )}

            {/* Follow-up checkboxes */}
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

            {/* Guard disclaimer & metadata */}
            <View style={styles.metaBox}>
              <Text style={styles.metaText}>
                Guarda actuante: {session.user.name} • {session.user.complexName}
              </Text>
              <Text style={styles.metaSub}>
                * Este informe registra la novedad observada y no determina la autoría ni el momento exacto en que ocurrió.
              </Text>
            </View>

            {/* Submit Button */}
            <TouchableOpacity
              style={[
                styles.submitBtn,
                (!plateInput || !description.trim() || submitting) && styles.btnDisabled,
              ]}
              onPress={handleSubmit}
              disabled={!plateInput || !description.trim() || submitting}
              activeOpacity={0.8}
            >
              {submitting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.submitBtnText}>GUARDAR REPORTE DE NOVEDAD</Text>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      ) : (
        <View style={styles.historyContainer}>
          {loadingHistory ? (
            <ActivityIndicator color="#0284c7" style={{ marginTop: 30 }} />
          ) : historyList.length === 0 ? (
            <View style={styles.emptyHistoryBox}>
              <Text style={styles.emptyHistoryText}>
                No se han registrado novedades durante este turno.
              </Text>
            </View>
          ) : (
            <FlatList
              data={historyList}
              keyExtractor={(item) => item.id}
              renderItem={renderHistoryItem}
              contentContainerStyle={{ padding: 16 }}
            />
          )}
        </View>
      )}

      {/* PLATE CAMERA MODAL */}
      <PlateCameraModal
        visible={cameraModalVisible}
        onClose={() => setCameraModalVisible(false)}
        onPlateDetected={handleCameraPlateDetected}
      />

      {/* PHOTO CAPTURE MODAL */}
      <PhotoCaptureModal
        visible={photoModalVisible}
        title="Fotografía de Novedad"
        onClose={() => setPhotoModalVisible(false)}
        onPhotoCaptured={(uri) => setCapturedPhotoUri(uri)}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#090d16" },
  tabBar: {
    flexDirection: "row",
    backgroundColor: "#111827",
    borderBottomWidth: 1,
    borderBottomColor: "#1f2937",
  },
  tabBtn: { flex: 1, paddingVertical: 12, alignItems: "center" },
  tabBtnActive: { borderBottomWidth: 2, borderBottomColor: "#0284c7" },
  tabText: { color: "#9ca3af", fontSize: 13, fontWeight: "600" },
  tabTextActive: { color: "#38bdf8", fontWeight: "bold" },
  feedbackBanner: {
    backgroundColor: "#064e3b",
    borderColor: "#059669",
    borderWidth: 1,
    padding: 10,
    marginHorizontal: 16,
    marginTop: 10,
    borderRadius: 8,
  },
  feedbackText: { color: "#a7f3d0", fontSize: 12, textAlign: "center", fontWeight: "600" },
  content: { padding: 16, paddingBottom: 32 },
  card: {
    backgroundColor: "#111827",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "#1f2937",
  },
  cardTitle: { color: "#f9fafb", fontSize: 15, fontWeight: "bold" },
  cardSub: { color: "#9ca3af", fontSize: 12, marginTop: 2, marginBottom: 12 },
  identifyRow: { flexDirection: "row", gap: 10 },
  plateInput: {
    flex: 1,
    backgroundColor: "#090d16",
    borderWidth: 1,
    borderColor: "#0284c7",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "#38bdf8",
    fontSize: 18,
    fontWeight: "bold",
    letterSpacing: 2,
    textAlign: "center",
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
  vehicleSummaryBox: {
    flexDirection: "row",
    backgroundColor: "#090d16",
    borderRadius: 8,
    padding: 12,
    marginTop: 10,
    borderWidth: 1,
    borderColor: "#1f2937",
    alignItems: "center",
  },
  summaryPlate: { color: "#f9fafb", fontSize: 16, fontWeight: "bold" },
  summaryDetails: { color: "#9ca3af", fontSize: 12, marginTop: 2 },
  summarySpace: { color: "#d1d5db", fontSize: 12, marginTop: 2 },
  presenceBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  badgeInside: { backgroundColor: "#059669" },
  badgeAway: { backgroundColor: "#0284c7" },
  presenceText: { color: "#fff", fontSize: 10, fontWeight: "bold" },
  fieldLabel: { color: "#d1d5db", fontSize: 12, fontWeight: "600", marginTop: 14, marginBottom: 8 },
  categoryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  catChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#090d16",
    borderWidth: 1,
    borderColor: "#374151",
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    gap: 6,
  },
  catChipActive: { borderColor: "#0284c7", backgroundColor: "#0c4a6e" },
  catIcon: { fontSize: 14 },
  catText: { color: "#9ca3af", fontSize: 12 },
  catTextActive: { color: "#38bdf8", fontWeight: "bold" },
  textArea: {
    backgroundColor: "#090d16",
    borderWidth: 1,
    borderColor: "#374151",
    borderRadius: 8,
    padding: 10,
    color: "#f9fafb",
    fontSize: 13,
  },
  takePhotoBtn: {
    backgroundColor: "#090d16",
    borderWidth: 1,
    borderColor: "#0284c7",
    borderStyle: "dashed",
    borderRadius: 8,
    padding: 12,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  takePhotoIcon: { fontSize: 18 },
  takePhotoText: { color: "#38bdf8", fontSize: 13, fontWeight: "600" },
  photoAttachedBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#090d16",
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#059669",
  },
  photoThumbnail: { width: 56, height: 56, borderRadius: 6, backgroundColor: "#000" },
  photoAttachedText: { color: "#10b981", fontSize: 13, fontWeight: "bold" },
  retakeBtn: { marginTop: 4 },
  retakeBtnText: { color: "#38bdf8", fontSize: 12 },
  checkboxRow: { flexDirection: "row", alignItems: "center", marginTop: 12, gap: 10 },
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
  metaBox: {
    backgroundColor: "#090d16",
    borderRadius: 8,
    padding: 10,
    marginTop: 16,
    borderWidth: 1,
    borderColor: "#1f2937",
  },
  metaText: { color: "#9ca3af", fontSize: 11, fontWeight: "600" },
  metaSub: { color: "#6b7280", fontSize: 11, marginTop: 4, fontStyle: "italic" },
  submitBtn: {
    backgroundColor: "#dc2626",
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 18,
  },
  submitBtnText: { color: "#fff", fontSize: 15, fontWeight: "bold" },
  btnDisabled: { opacity: 0.5 },

  // History styles
  historyContainer: { flex: 1 },
  historyCard: {
    backgroundColor: "#111827",
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#1f2937",
  },
  historyHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  cardPlate: { color: "#f9fafb", fontSize: 18, fontWeight: "bold" },
  categoryBadge: { color: "#f59e0b", fontSize: 12, marginTop: 2 },
  cardTime: { color: "#6b7280", fontSize: 12 },
  cardDesc: { color: "#d1d5db", fontSize: 13, marginTop: 8 },
  historyPhotoRow: { flexDirection: "row", alignItems: "center", marginTop: 8, gap: 8 },
  historyThumbnail: { width: 44, height: 44, borderRadius: 4, backgroundColor: "#000" },
  photoTagText: { color: "#38bdf8", fontSize: 12 },
  tagRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  cctvTag: { backgroundColor: "#1e3a8a", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  ownerTag: { backgroundColor: "#78350f", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  tagText: { color: "#fff", fontSize: 10, fontWeight: "bold" },
  reporterText: { color: "#6b7280", fontSize: 11, marginTop: 8, textAlign: "right" },
  emptyHistoryBox: { padding: 32, alignItems: "center" },
  emptyHistoryText: { color: "#6b7280", fontSize: 14 },
});
