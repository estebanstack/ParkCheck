// ParkCheck Mobile - Control de Acceso Portería (es-CO)
// Workflow: Seleccionar (Entrada / Salida) -> Escaneo con Cámara Real (ML Kit) o Manual
// -> Identificar Vehículo, Espacio y Presencia -> Confirmar Movimiento -> Persistir
// Specification Reference: Section 1, 2, 6, 7

import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ScrollView,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { StorageService } from "../services/storage";
import { SyncManager } from "../services/syncManager";
import { OcrService, RecognizedPlateResult } from "../services/ocrService";
import { PlateCameraModal } from "../components/PlateCameraModal";
import { normalizePlate, validatePlateFormat } from "../../../src/domain/plateService";
import { AuthSession, CachedVehicle } from "../types/outbox";

interface Props {
  session: AuthSession;
}

export function GateScreen({ session }: Props) {
  // Gate Intent: 'ARRIVAL' (Entrada) or 'DEPARTURE' (Salida)
  const [activeIntent, setActiveIntent] = useState<"ARRIVAL" | "DEPARTURE" | null>(null);

  // Workflow modal & camera state
  const [modalVisible, setModalVisible] = useState(false);
  const [cameraModalVisible, setCameraModalVisible] = useState(false);
  const [plateInput, setPlateInput] = useState("");
  const [recognizedResult, setRecognizedResult] = useState<RecognizedPlateResult | null>(null);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [lastFeedback, setLastFeedback] = useState<{
    message: string;
    isLocal: boolean;
  } | null>(null);

  // Quick Register Modal state
  const [regModalVisible, setRegModalVisible] = useState(false);
  const [regPlate, setRegPlate] = useState("");
  const [regSpace, setRegSpace] = useState("");
  const [regDetails, setRegDetails] = useState("");
  const [regSubmitting, setRegSubmitting] = useState(false);

  // Open gate movement workflow with explicit intent
  const openGateWorkflow = (intent: "ARRIVAL" | "DEPARTURE") => {
    setActiveIntent(intent);
    setPlateInput("");
    setRecognizedResult(null);
    setNotes("");
    setModalVisible(true);
  };

  // Run plate lookup when guard types or updates plate
  const handlePlateChange = async (text: string) => {
    const clean = normalizePlate(text);
    setPlateInput(clean);

    if (clean.length >= 3 && activeIntent) {
      const result = await OcrService.lookupPlateAndValidate(clean, activeIntent);
      setRecognizedResult(result);
    } else {
      setRecognizedResult(null);
    }
  };

  // Handle successful plate detection from real camera OCR
  const handlePlateDetected = (result: RecognizedPlateResult) => {
    setPlateInput(result.selectedPlate);
    setRecognizedResult(result);
  };

  // Select alternate OCR candidate if multiple candidates detected
  const handleSelectCandidate = async (candidatePlate: string) => {
    if (!activeIntent) return;
    setPlateInput(candidatePlate);
    const result = await OcrService.lookupPlateAndValidate(candidatePlate, activeIntent);
    setRecognizedResult(result);
  };

  // Confirm Movement Registration
  const handleConfirmMovement = async () => {
    if (!activeIntent) return;

    const validation = validatePlateFormat(plateInput);
    if (!validation.isValid) {
      Alert.alert("Placa Inválida", validation.error || "Ingrese una placa válida.");
      return;
    }

    const cleanPlate = validation.normalizedPlate;

    // Check if vehicle is unregistered in local manifest
    if (!recognizedResult?.isRegistered) {
      Alert.alert(
        "Vehículo No Registrado",
        `La placa ${cleanPlate} no figura en el censo oficial de este conjunto. ¿Cómo desea proceder?`,
        [
          { text: "Cancelar", style: "cancel" },
          {
            text: "Registrar al Censo",
            onPress: () => {
              setModalVisible(false);
              setRegPlate(cleanPlate);
              setRegSpace("");
              setRegDetails("");
              setRegModalVisible(true);
            },
          },
          {
            text: "Registrar como Visitante",
            onPress: () => executeSaveMovement(cleanPlate, true),
          },
        ]
      );
      return;
    }

    // Check if contradictory warning is present (e.g. vehicle already INSIDE attempting ARRIVAL)
    if (recognizedResult.movementValidation?.isContradictory) {
      Alert.alert(
        "Advertencia de Presencia",
        recognizedResult.movementValidation.warningMessage ||
          "El movimiento contradice la presencia previa registrada. ¿Desea confirmar de todos modos?",
        [
          { text: "Cancelar", style: "cancel" },
          {
            text: "Confirmar de Todos Modos",
            style: "destructive",
            onPress: () => executeSaveMovement(cleanPlate, false),
          },
        ]
      );
      return;
    }

    await executeSaveMovement(cleanPlate, false);
  };

  const executeSaveMovement = async (plateToSave: string, isUnregisteredVisitor: boolean) => {
    if (!activeIntent) return;
    setSubmitting(true);

    const clientEventId = `mov-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const effectiveNotes = notes
      ? `${notes} ${isUnregisteredVisitor ? "[VISITANTE_NO_CENSADO]" : ""}`.trim()
      : isUnregisteredVisitor
      ? "[VISITANTE_NO_CENSADO]"
      : undefined;

    try {
      // 1. Enqueue outbox event for sync (idempotent, durable)
      await StorageService.enqueueEvent(clientEventId, session.user.complexId, "MOVEMENT", {
        plate: plateToSave,
        movementType: activeIntent,
        notes: effectiveNotes,
        source: recognizedResult?.rawDetected ? "CAMERA_OCR" : "PLATE_MANUAL",
      });

      // 2. Update local vehicle presence state & return obligations!
      const updatedVehicle = await StorageService.recordMovementInCache(plateToSave, activeIntent, {
        notes: effectiveNotes,
        source: recognizedResult?.rawDetected ? "CAMERA_OCR" : "PLATE_MANUAL",
        complexId: session.user.complexId,
      });

      const intentLabel = activeIntent === "ARRIVAL" ? "Ingreso" : "Salida";
      const isOfflineShift = session.isOfflineMode || session.token.startsWith("offline_");
      const persistenceStatus = isOfflineShift
        ? "Guardado localmente (pendiente de sincronización)"
        : "Registrado y en sincronización";

      const taskDetail =
        activeIntent === "ARRIVAL"
          ? " • Ronda de retorno programada (30m)"
          : " • Obligaciones preservadas en historial";

      setLastFeedback({
        message: `✓ ${intentLabel} confirmado: ${plateToSave} (${updatedVehicle.presenceStatus === "INSIDE" ? "DENTRO" : "FUERA"})${taskDetail}\n${persistenceStatus}`,
        isLocal: isOfflineShift,
      });

      setModalVisible(false);

      // Trigger sync if online authenticated
      if (!isOfflineShift) {
        SyncManager.synchronize().catch(() => {});
      }
    } catch (err: any) {
      Alert.alert("Error", err.message || "Error al registrar movimiento.");
    } finally {
      setSubmitting(false);
    }
  };

  // Quick Register Vehicle
  const handleRegisterVehicle = async () => {
    const val = validatePlateFormat(regPlate);
    if (!val.isValid) {
      Alert.alert("Placa Inválida", val.error || "Ingrese una placa válida");
      return;
    }

    setRegSubmitting(true);
    try {
      const newVeh = await StorageService.registerVehicleInCache({
        plate: val.normalizedPlate,
        parkingSpace: regSpace.trim() || undefined,
        presenceStatus: "INSIDE",
        make: regDetails.trim() || undefined,
        complexId: session.user.complexId,
      });

      // Enqueue registration event for backend
      await StorageService.enqueueEvent(
        `reg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        session.user.complexId,
        "VEHICLE_REGISTRATION",
        {
          plate: newVeh.plate,
          parkingSpace: newVeh.parkingSpace,
          initialPresence: newVeh.presenceStatus,
        }
      );

      setRegModalVisible(false);
      setLastFeedback({
        message: `✓ Vehículo ${newVeh.plate} agregado al censo local.`,
        isLocal: true,
      });

      // If gate workflow was open, re-link newly registered vehicle
      if (activeIntent) {
        setPlateInput(newVeh.plate);
        const r = await OcrService.lookupPlateAndValidate(newVeh.plate, activeIntent);
        setRecognizedResult(r);
        setModalVisible(true);
      }
    } catch (err: any) {
      Alert.alert("Error de Registro", err.message || "No se pudo registrar el vehículo.");
    } finally {
      setRegSubmitting(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header Info */}
      <View style={styles.card}>
        <Text style={styles.headerTitle}>Control de Movimientos de Portería</Text>
        <Text style={styles.headerSubtitle}>
          Seleccione la acción para registrar el paso vehicular:
        </Text>

        {lastFeedback && (
          <View
            style={[
              styles.feedbackBanner,
              lastFeedback.isLocal ? styles.bannerLocal : styles.bannerSynced,
            ]}
          >
            <Text style={styles.feedbackText}>{lastFeedback.message}</Text>
          </View>
        )}

        {/* PROMINENT PRIMARY GATE BUTTONS */}
        <View style={styles.primaryActionContainer}>
          <TouchableOpacity
            style={styles.entryButton}
            onPress={() => openGateWorkflow("ARRIVAL")}
            activeOpacity={0.85}
          >
            <Text style={styles.btnIcon}>🚗 ⬇️</Text>
            <Text style={styles.primaryBtnTitle}>REGISTRAR ENTRADA</Text>
            <Text style={styles.primaryBtnDesc}>
              Vehículo ingresa a las instalaciones
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.exitButton}
            onPress={() => openGateWorkflow("DEPARTURE")}
            activeOpacity={0.85}
          >
            <Text style={styles.btnIcon}>🚗 ⬆️</Text>
            <Text style={styles.primaryBtnTitle}>REGISTRAR SALIDA</Text>
            <Text style={styles.primaryBtnDesc}>
              Vehículo sale de las instalaciones
            </Text>
          </TouchableOpacity>
        </View>

        {/* Secondary census registry button */}
        <View style={styles.secondarySection}>
          <TouchableOpacity
            style={styles.altBtn}
            onPress={() => {
              setRegPlate("");
              setRegSpace("");
              setRegDetails("");
              setRegModalVisible(true);
            }}
            activeOpacity={0.8}
          >
            <Text style={styles.altBtnText}>➕ Registrar Vehículo al Censo</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* GATE WORKFLOW MODAL */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <View>
                <Text
                  style={[
                    styles.modalTitle,
                    activeIntent === "ARRIVAL"
                      ? styles.titleEntry
                      : styles.titleExit,
                  ]}
                >
                  {activeIntent === "ARRIVAL"
                    ? "REGISTRAR ENTRADA"
                    : "REGISTRAR SALIDA"}
                </Text>
                <Text style={styles.modalSubtitle}>
                  {activeIntent === "ARRIVAL"
                    ? "Confirmar ingreso • Crea ronda de retorno"
                    : "Confirmar salida • Preserva obligaciones"}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setModalVisible(false)}
                style={styles.closeTouch}
              >
                <Text style={styles.closeBtn}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView
              contentContainerStyle={{ paddingBottom: 24 }}
              keyboardShouldPersistTaps="handled"
            >
              {/* REAL CAMERA SCAN TRIGGER */}
              <TouchableOpacity
                style={styles.ocrScannerBox}
                onPress={() => setCameraModalVisible(true)}
                activeOpacity={0.8}
              >
                <Text style={styles.cameraIcon}>📷</Text>
                <Text style={styles.ocrPrompt}>Escanear Placa con Cámara</Text>
                <Text style={styles.ocrSubprompt}>
                  Abre la cámara para reconocimiento óptico local (Google ML Kit)
                </Text>
              </TouchableOpacity>

              {/* Plate Input with Colombian format */}
              <Text style={styles.label}>Placa del Vehículo (Colombia)</Text>
              <TextInput
                style={styles.plateInput}
                value={plateInput}
                onChangeText={handlePlateChange}
                placeholder="EJ: KHY842"
                placeholderTextColor="#475569"
                autoCapitalize="characters"
                maxLength={8}
                autoCorrect={false}
              />

              {/* Alternate OCR Candidates if detected */}
              {recognizedResult?.candidates &&
                recognizedResult.candidates.length > 1 && (
                  <View style={styles.candidatesRow}>
                    <Text style={styles.candidateLabel}>Coincidencias:</Text>
                    {recognizedResult.candidates.map((c, idx) => (
                      <TouchableOpacity
                        key={idx}
                        style={[
                          styles.candidateChip,
                          plateInput === c.plate && styles.candidateChipActive,
                        ]}
                        onPress={() => handleSelectCandidate(c.plate)}
                      >
                        <Text style={styles.candidateText}>
                          {c.plate} ({Math.round(c.confidence * 100)}%)
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

              {/* VEHICLE VERIFICATION & PRESENCE STATE CARD */}
              {recognizedResult && (
                <View style={styles.verificationCard}>
                  {recognizedResult.isRegistered ? (
                    <>
                      <View style={styles.verifRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.verifPlate}>
                            {recognizedResult.registeredVehicle?.plate}
                          </Text>
                          {recognizedResult.registeredVehicle?.make ? (
                            <Text style={styles.vehicleDetailsText}>
                              {recognizedResult.registeredVehicle.make}{" "}
                              {recognizedResult.registeredVehicle.model || ""}{" "}
                              {recognizedResult.registeredVehicle.color || ""}
                            </Text>
                          ) : null}
                        </View>
                        <View
                          style={[
                            styles.presenceBadge,
                            recognizedResult.registeredVehicle?.presenceStatus ===
                            "INSIDE"
                              ? styles.badgeInside
                              : recognizedResult.registeredVehicle?.presenceStatus ===
                                "AWAY"
                              ? styles.badgeAway
                              : styles.badgeUncertain,
                          ]}
                        >
                          <Text style={styles.presenceText}>
                            {recognizedResult.registeredVehicle?.presenceStatus ===
                            "INSIDE"
                              ? "DENTRO"
                              : recognizedResult.registeredVehicle?.presenceStatus ===
                                "AWAY"
                              ? "FUERA"
                              : "INCIERTO"}
                          </Text>
                        </View>
                      </View>

                      <Text style={styles.spaceInfo}>
                        📍 Espacio:{" "}
                        {recognizedResult.registeredVehicle?.parkingSpace ||
                          "Sin espacio asignado"}
                      </Text>

                      {/* Movement Compatibility Check */}
                      {recognizedResult.movementValidation?.isContradictory ? (
                        <View style={styles.warningBox}>
                          <Text style={styles.warningTitle}>
                            ⚠️ Advertencia de Presencia
                          </Text>
                          <Text style={styles.warningText}>
                            {recognizedResult.movementValidation.warningMessage}
                          </Text>
                        </View>
                      ) : (
                        <View style={styles.successBox}>
                          <Text style={styles.successText}>
                            ✓ Movimiento coherente con el estado de presencia
                          </Text>
                        </View>
                      )}
                    </>
                  ) : (
                    <View style={styles.unregisteredBox}>
                      <Text style={styles.unregisteredTitle}>
                        🚫 Vehículo No Registrado en el Censo Oficial
                      </Text>
                      <Text style={styles.unregisteredText}>
                        La placa {plateInput} no figura en la lista de residentes.
                        Puede registrar el paso como visitante o agregarlo al
                        censo.
                      </Text>
                    </View>
                  )}
                </View>
              )}

              {/* Observation Notes */}
              <Text style={styles.label}>Notas u Observación (Opcional)</Text>
              <TextInput
                style={styles.notesInput}
                value={notes}
                onChangeText={setNotes}
                placeholder="Ej: Domicilio, visitante apto 402, conductor autorizado..."
                placeholderTextColor="#475569"
              />

              {/* CONFIRM BUTTON (Ordinary arrival/departure does not require photo!) */}
              <TouchableOpacity
                style={[
                  styles.confirmBtn,
                  activeIntent === "ARRIVAL"
                    ? styles.confirmEntry
                    : styles.confirmExit,
                  (!plateInput || submitting) && styles.btnDisabled,
                ]}
                onPress={handleConfirmMovement}
                disabled={!plateInput || submitting}
                activeOpacity={0.8}
              >
                {submitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.confirmBtnText}>
                    {activeIntent === "ARRIVAL"
                      ? "CONFIRMAR ENTRADA"
                      : "CONFIRMAR SALIDA"}
                  </Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* REAL CAMERA SCANNER MODAL */}
      <PlateCameraModal
        visible={cameraModalVisible}
        intendedMovement={activeIntent || undefined}
        onClose={() => setCameraModalVisible(false)}
        onPlateDetected={handlePlateDetected}
      />

      {/* QUICK VEHICLE REGISTRATION MODAL */}
      <Modal
        visible={regModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setRegModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Registrar Vehículo al Censo</Text>
              <TouchableOpacity
                onPress={() => setRegModalVisible(false)}
                style={styles.closeTouch}
              >
                <Text style={styles.closeBtn}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView
              contentContainerStyle={{ paddingBottom: 24 }}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={styles.label}>Placa del Vehículo</Text>
              <TextInput
                style={styles.plateInput}
                value={regPlate}
                onChangeText={(t) => setRegPlate(normalizePlate(t))}
                placeholder="EJ: ABC123"
                placeholderTextColor="#475569"
                autoCapitalize="characters"
                maxLength={8}
              />

              <Text style={styles.label}>Parqueadero / Apartamento</Text>
              <TextInput
                style={styles.inputField}
                value={regSpace}
                onChangeText={setRegSpace}
                placeholder="Ej: Torre 1 - P102 / Apto 304"
                placeholderTextColor="#475569"
              />

              <Text style={styles.label}>Marca / Modelo / Color (Opcional)</Text>
              <TextInput
                style={styles.inputField}
                value={regDetails}
                onChangeText={setRegDetails}
                placeholder="Ej: Renault Duster Gris"
                placeholderTextColor="#475569"
              />

              <TouchableOpacity
                style={[
                  styles.confirmBtn,
                  styles.confirmEntry,
                  (!regPlate || regSubmitting) && styles.btnDisabled,
                ]}
                onPress={handleRegisterVehicle}
                disabled={!regPlate || regSubmitting}
                activeOpacity={0.8}
              >
                {regSubmitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.confirmBtnText}>GUARDAR EN CENSO</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#090d16" },
  content: { padding: 16 },
  card: {
    backgroundColor: "#111827",
    borderRadius: 12,
    padding: 18,
    borderWidth: 1,
    borderColor: "#1f2937",
  },
  headerTitle: { fontSize: 20, fontWeight: "bold", color: "#f9fafb" },
  headerSubtitle: {
    fontSize: 13,
    color: "#9ca3af",
    marginTop: 4,
    marginBottom: 16,
  },
  feedbackBanner: {
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  bannerLocal: {
    backgroundColor: "#1e1b4b",
    borderWidth: 1,
    borderColor: "#6366f1",
  },
  bannerSynced: {
    backgroundColor: "#064e3b",
    borderWidth: 1,
    borderColor: "#059669",
  },
  feedbackText: {
    color: "#f3f4f6",
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
    lineHeight: 18,
  },
  primaryActionContainer: { gap: 14 },
  entryButton: {
    backgroundColor: "#064e3b",
    borderColor: "#10b981",
    borderWidth: 2,
    borderRadius: 12,
    paddingVertical: 18,
    paddingHorizontal: 16,
    alignItems: "center",
  },
  exitButton: {
    backgroundColor: "#78350f",
    borderColor: "#f59e0b",
    borderWidth: 2,
    borderRadius: 12,
    paddingVertical: 18,
    paddingHorizontal: 16,
    alignItems: "center",
  },
  btnIcon: { fontSize: 28, marginBottom: 4 },
  primaryBtnTitle: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "bold",
    letterSpacing: 0.5,
  },
  primaryBtnDesc: { color: "#d1d5db", fontSize: 13, marginTop: 4 },
  secondarySection: { marginTop: 18, paddingTop: 14, borderTopWidth: 1, borderTopColor: "#1f2937" },
  altBtn: {
    backgroundColor: "#1f2937",
    borderWidth: 1,
    borderColor: "#374151",
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
  },
  altBtnText: { color: "#9ca3af", fontSize: 13, fontWeight: "600" },

  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.85)",
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: "#111827",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 18,
    maxHeight: "92%",
    borderTopWidth: 1,
    borderTopColor: "#374151",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 16,
  },
  modalTitle: { fontSize: 19, fontWeight: "bold" },
  titleEntry: { color: "#10b981" },
  titleExit: { color: "#f59e0b" },
  modalSubtitle: { color: "#9ca3af", fontSize: 12, marginTop: 2 },
  closeTouch: { padding: 6 },
  closeBtn: { color: "#9ca3af", fontSize: 20, fontWeight: "bold" },
  ocrScannerBox: {
    backgroundColor: "#090d16",
    borderWidth: 2,
    borderColor: "#0284c7",
    borderStyle: "dashed",
    borderRadius: 10,
    padding: 16,
    alignItems: "center",
    marginBottom: 14,
  },
  cameraIcon: { fontSize: 30, marginBottom: 4 },
  ocrPrompt: { color: "#38bdf8", fontSize: 15, fontWeight: "bold" },
  ocrSubprompt: {
    color: "#6b7280",
    fontSize: 12,
    marginTop: 2,
    textAlign: "center",
  },
  label: {
    color: "#d1d5db",
    fontSize: 13,
    marginBottom: 6,
    marginTop: 10,
    fontWeight: "500",
  },
  plateInput: {
    backgroundColor: "#090d16",
    borderWidth: 2,
    borderColor: "#0284c7",
    borderRadius: 8,
    padding: 12,
    color: "#38bdf8",
    fontSize: 24,
    fontWeight: "bold",
    textAlign: "center",
    letterSpacing: 4,
  },
  inputField: {
    backgroundColor: "#090d16",
    borderWidth: 1,
    borderColor: "#374151",
    borderRadius: 8,
    padding: 12,
    color: "#f9fafb",
    fontSize: 15,
  },
  candidatesRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 8,
    alignItems: "center",
  },
  candidateLabel: { color: "#9ca3af", fontSize: 12 },
  candidateChip: {
    backgroundColor: "#090d16",
    borderWidth: 1,
    borderColor: "#374151",
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  candidateChipActive: { borderColor: "#0284c7", backgroundColor: "#075985" },
  candidateText: { color: "#f9fafb", fontSize: 12, fontWeight: "500" },
  verificationCard: {
    backgroundColor: "#090d16",
    borderRadius: 10,
    padding: 12,
    marginTop: 12,
    borderWidth: 1,
    borderColor: "#1f2937",
  },
  verifRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  verifPlate: { color: "#f9fafb", fontSize: 20, fontWeight: "bold" },
  vehicleDetailsText: { color: "#9ca3af", fontSize: 12, marginTop: 2 },
  presenceBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  badgeInside: { backgroundColor: "#059669" },
  badgeAway: { backgroundColor: "#0284c7" },
  badgeUncertain: { backgroundColor: "#dc2626" },
  presenceText: { color: "#fff", fontSize: 11, fontWeight: "bold" },
  spaceInfo: { color: "#9ca3af", fontSize: 13, marginTop: 6 },
  warningBox: {
    backgroundColor: "#451a03",
    borderWidth: 1,
    borderColor: "#f59e0b",
    borderRadius: 8,
    padding: 10,
    marginTop: 8,
  },
  warningTitle: { color: "#f59e0b", fontSize: 12, fontWeight: "bold" },
  warningText: { color: "#fed7aa", fontSize: 12, marginTop: 2 },
  successBox: {
    backgroundColor: "#064e3b",
    borderRadius: 8,
    padding: 8,
    marginTop: 8,
  },
  successText: { color: "#6ee7b7", fontSize: 12 },
  unregisteredBox: {
    backgroundColor: "#450a0a",
    borderWidth: 1,
    borderColor: "#ef4444",
    borderRadius: 8,
    padding: 10,
  },
  unregisteredTitle: { color: "#f87171", fontSize: 12, fontWeight: "bold" },
  unregisteredText: { color: "#fca5a5", fontSize: 12, marginTop: 4 },
  notesInput: {
    backgroundColor: "#090d16",
    borderWidth: 1,
    borderColor: "#374151",
    borderRadius: 8,
    padding: 10,
    color: "#f9fafb",
    marginTop: 4,
  },
  confirmBtn: {
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 18,
  },
  confirmEntry: { backgroundColor: "#059669" },
  confirmExit: { backgroundColor: "#d97706" },
  confirmBtnText: { color: "#fff", fontSize: 15, fontWeight: "bold" },
  btnDisabled: { opacity: 0.5 },
});
