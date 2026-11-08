import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, validateCsrfOrigin } from "@/domain/auth";
import { prisma } from "@/domain/serverScheduler";
import { saveAttachmentFile } from "@/domain/storageDriver";

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
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const contentType = req.headers.get("content-type") || "";
    let incidentId: string | null = null;
    let incidentClientEventId: string | null = null;
    let originalName = `photo-${Date.now()}.jpg`;
    let mimeType = "image/jpeg";
    let buffer: Buffer;

    if (contentType.includes("multipart/form-data")) {
      const formData: any = await req.formData();
      const file = formData.get("file") as File | null;
      incidentId = (formData.get("incidentId") as string) || null;
      incidentClientEventId = (formData.get("incidentClientEventId") as string) || null;

      if (!file) {
        return NextResponse.json({ error: "Archivo 'file' requerido" }, { status: 400 });
      }

      originalName = file.name || originalName;
      mimeType = file.type || mimeType;
      const arrayBuffer = await file.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
    } else {
      // JSON with base64 data
      const json = await req.json();
      incidentId = json.incidentId || null;
      incidentClientEventId = json.incidentClientEventId || null;
      originalName = json.originalName || originalName;
      mimeType = json.mimeType || mimeType;

      if (!json.base64Data) {
        return NextResponse.json({ error: "Campo 'base64Data' requerido" }, { status: 400 });
      }

      buffer = Buffer.from(json.base64Data, "base64");
    }

    const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
    const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

    if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
      return NextResponse.json(
        { error: `Tipo de archivo no permitido ('${mimeType}'). Solo se admiten imágenes JPEG, PNG y WEBP.` },
        { status: 400 }
      );
    }

    if (buffer.length > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `El archivo supera el tamaño máximo permitido de 10 MB (${(buffer.length / (1024 * 1024)).toFixed(2)} MB).` },
        { status: 400 }
      );
    }

    // Resolve incident by clientEventId if incidentId not directly supplied
    if (!incidentId && incidentClientEventId) {
      const parentLog = await prisma.syncEventLog.findUnique({
        where: {
          complexId_clientEventId: {
            complexId: session.complexId,
            clientEventId: incidentClientEventId,
          },
        },
      });

      if (parentLog?.entityId) {
        incidentId = parentLog.entityId;
      }
    }

    if (!incidentId) {
      return NextResponse.json(
        { error: "No se encontró el incidente asociado para este adjunto" },
        { status: 404 }
      );
    }

    // Validate incident complex ownership
    const incident = await prisma.incident.findUnique({
      where: { id: incidentId },
    });

    if (!incident || incident.complexId !== session.complexId) {
      return NextResponse.json(
        { error: "Incidente no encontrado o no pertenece a su conjunto asignado" },
        { status: 403 }
      );
    }

    // Idempotent retry deduplication: check if identical attachment was already stored
    const existingAttachment = await prisma.incidentAttachment.findFirst({
      where: {
        incidentId,
        originalName,
        fileSize: buffer.length,
      },
    });

    if (existingAttachment) {
      return NextResponse.json({
        success: true,
        duplicate: true,
        attachment: existingAttachment,
      });
    }

    // Persist file via durable storage driver
    const { storageKey } = await saveAttachmentFile(session.complexId, originalName, buffer);

    const attachment = await prisma.incidentAttachment.create({
      data: {
        incidentId,
        storageKey,
        originalName,
        mimeType,
        fileSize: buffer.length,
        attachmentType: "DAMAGE_PHOTO",
      },
    });

    return NextResponse.json({
      success: true,
      attachment: {
        id: attachment.id,
        incidentId: attachment.incidentId,
        storageKey: attachment.storageKey,
        originalName: attachment.originalName,
        mimeType: attachment.mimeType,
        fileSize: attachment.fileSize,
        uploadedAt: attachment.uploadedAt,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Error al subir adjunto" },
      { status: 500 }
    );
  }
}
