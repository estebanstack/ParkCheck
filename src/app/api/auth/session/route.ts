import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, validateCsrfOrigin } from "@/domain/auth";

export async function POST(req: NextRequest) {
  if (!validateCsrfOrigin(req)) {
    return NextResponse.json(
      { error: "Solicitud rechazada: origen no autorizado (protección CSRF)" },
      { status: 403 }
    );
  }

  const response = NextResponse.json({ success: true });
  response.cookies.delete("parkcheck_session");
  return response;
}

export async function GET(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }
  return NextResponse.json({ authenticated: true, session });
}
