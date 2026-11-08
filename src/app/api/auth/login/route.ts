import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/domain/serverScheduler";
import bcrypt from "bcryptjs";
import { signSessionToken } from "@/domain/auth";

export async function POST(req: NextRequest) {
  try {
    const { email, password, complexId } = await req.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: "Correo electrónico y contraseña requeridos" },
        { status: 400 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        siteRoles: {
          include: {
            complex: true,
          },
        },
      },
    });

    if (!user || !user.active) {
      return NextResponse.json(
        { error: "Credenciales inválidas o usuario inactivo" },
        { status: 401 }
      );
    }

    const validPassword = await bcrypt.compare(password, user.passwordHash);
    if (!validPassword) {
      return NextResponse.json(
        { error: "Credenciales inválidas" },
        { status: 401 }
      );
    }

    if (user.siteRoles.length === 0) {
      return NextResponse.json(
        { error: "El usuario no tiene conjuntos residenciales asignados" },
        { status: 403 }
      );
    }

    // Pick targeted complex or default to first assigned complex
    const matchedRole = complexId
      ? user.siteRoles.find((sr) => sr.complexId === complexId)
      : user.siteRoles[0];

    if (!matchedRole) {
      return NextResponse.json(
        { error: "Acceso no autorizado al conjunto seleccionado" },
        { status: 403 }
      );
    }

    const token = signSessionToken({
      userId: user.id,
      email: user.email,
      name: user.name,
      complexId: matchedRole.complexId,
      role: matchedRole.role,
    });

    const response = NextResponse.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: matchedRole.role,
        complexId: matchedRole.complexId,
        complexName: matchedRole.complex.name,
        availableRoles: user.siteRoles.map((sr) => ({
          complexId: sr.complexId,
          complexName: sr.complex.name,
          complexCode: sr.complex.code,
          role: sr.role,
        })),
      },
    });

    response.cookies.set("parkcheck_session", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 12, // 12 hours
    });

    return response;
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Error interno del servidor" },
      { status: 500 }
    );
  }
}
