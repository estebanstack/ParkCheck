// ParkCheck - Vehicle Registration & Management API
// Specification Reference: Section 2, 8, 12

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, validateCsrfOrigin } from "@/domain/auth";
import { prisma } from "@/domain/serverScheduler";
import { validatePlateFormat } from "@/domain/plateService";

export async function POST(req: NextRequest) {
  try {
    if (!validateCsrfOrigin(req)) {
      return NextResponse.json(
        { error: "Solicitud rechazada: origen no autorizado (protección CSRF)" },
        { status: 403 }
      );
    }

    const session = getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json(
        { error: "No autenticado. Inicie sesión para registrar vehículos." },
        { status: 401 }
      );
    }

    // Role verification: Supervisors, Admins, or Platform Admins
    const isAuthorized =
      session.role === "SUPERVISOR" ||
      session.role === "RESIDENTIAL_ADMIN" ||
      session.role === "PLATFORM_ADMIN";

    if (!isAuthorized) {
      return NextResponse.json(
        {
          error: `Acceso denegado: el rol '${session.role}' no tiene permisos para registrar vehículos en el sistema.`,
        },
        { status: 403 }
      );
    }

    const {
      plate,
      parkingSpace,
      stickerToken,
      initialPresence = "INSIDE",
      verificationDetails,
    } = await req.json();

    if (!plate) {
      return NextResponse.json(
        { error: "La placa del vehículo es obligatoria." },
        { status: 400 }
      );
    }

    const validation = validatePlateFormat(plate);
    if (!validation.isValid) {
      return NextResponse.json(
        { error: validation.error || "Formato de placa inválido" },
        { status: 400 }
      );
    }

    const normalizedPlate = validation.normalizedPlate;

    return await prisma.$transaction(async (tx) => {
      // Check plate uniqueness within this specific residential complex
      const existing = await tx.vehicle.findUnique({
        where: {
          complexId_plate: {
            complexId: session.complexId,
            plate: normalizedPlate,
          },
        },
      });

      if (existing) {
        return NextResponse.json(
          {
            error: `El vehículo con placa ${normalizedPlate} ya está registrado en este conjunto residencial.`,
            existingId: existing.id,
          },
          { status: 409 }
        );
      }

      // If stickerToken provided, ensure global uniqueness if non-empty
      if (stickerToken) {
        const tokenExists = await tx.vehicle.findFirst({
          where: { stickerToken: stickerToken.trim() },
        });
        if (tokenExists) {
          return NextResponse.json(
            { error: `El chip/token NFC '${stickerToken}' ya se encuentra asignado a otro vehículo.` },
            { status: 409 }
          );
        }
      }

      const vehicle = await tx.vehicle.create({
        data: {
          complexId: session.complexId,
          plate: normalizedPlate,
          parkingSpace: parkingSpace?.trim() || null,
          stickerToken: stickerToken?.trim() || null,
          active: true,
        },
      });

      // Initialize presence state
      const presence = await tx.vehiclePresence.create({
        data: {
          vehicleId: vehicle.id,
          currentStatus: initialPresence === "AWAY" ? "AWAY" : "INSIDE",
          verificationDetails: verificationDetails?.trim() || "Registro inicial autorizado",
        },
      });

      // Audit log entry
      await tx.auditLog.create({
        data: {
          complexId: session.complexId,
          userId: session.userId,
          action: "VEHICLE_REGISTERED",
          entityType: "VEHICLE",
          entityId: vehicle.id,
          detailsJson: JSON.stringify({
            plate: normalizedPlate,
            parkingSpace: vehicle.parkingSpace,
            vehicleType: validation.vehicleType,
            initialPresence: presence.currentStatus,
            registeredBy: session.name,
          }),
        },
      });

      return NextResponse.json(
        {
          success: true,
          vehicle: {
            id: vehicle.id,
            plate: vehicle.plate,
            parkingSpace: vehicle.parkingSpace,
            stickerToken: vehicle.stickerToken,
            presenceStatus: presence.currentStatus,
            vehicleType: validation.vehicleType,
            createdAt: vehicle.createdAt,
          },
        },
        { status: 201 }
      );
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Error al registrar vehículo en la base de datos." },
      { status: 500 }
    );
  }
}
