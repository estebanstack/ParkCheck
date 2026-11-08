import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/domain/auth";
import { prisma } from "@/domain/serverScheduler";

export async function GET(req: NextRequest) {
  try {
    const session = getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const search = (
      searchParams.get("search") ||
      searchParams.get("plate") ||
      searchParams.get("q") ||
      ""
    ).trim();

    const presenceFilter = searchParams.get("presence")?.trim().toUpperCase();

    // Parse and validate pagination
    const rawPage = parseInt(searchParams.get("page") || "1", 10);
    const rawLimit = parseInt(searchParams.get("limit") || "10", 10);

    const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;
    const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 50) : 10;
    const skip = (page - 1) * limit;

    // Build scoped query strictly isolating by complexId
    const where: any = {
      complexId: session.complexId,
      active: true,
    };

    if (search) {
      where.OR = [
        { plate: { contains: search.toUpperCase() } },
        { parkingSpace: { contains: search, mode: "insensitive" } },
        { stickerToken: { contains: search, mode: "insensitive" } },
      ];
    }

    if (
      presenceFilter &&
      (presenceFilter === "INSIDE" ||
        presenceFilter === "AWAY" ||
        presenceFilter === "UNCERTAIN")
    ) {
      where.presence = {
        currentStatus: presenceFilter,
      };
    }

    const [total, vehicles] = await Promise.all([
      prisma.vehicle.count({ where }),
      prisma.vehicle.findMany({
        where,
        include: { presence: true },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip,
        take: limit,
      }),
    ]);

    return NextResponse.json({
      success: true,
      vehicles: vehicles.map((v) => ({
        id: v.id,
        plate: v.plate,
        parkingSpace: v.parkingSpace,
        stickerToken: v.stickerToken,
        presenceStatus: v.presence?.currentStatus || "INSIDE",
        verificationDetails: v.presence?.verificationDetails,
        createdAt: v.createdAt,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Error al consultar censo vehicular" },
      { status: 500 }
    );
  }
}
