import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const sessionCookie = request.cookies.get("parkcheck_session")?.value;
  const { pathname } = request.nextUrl;

  // Protect root dashboard: if no session cookie, redirect directly to /login
  if (!sessionCookie && pathname === "/") {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/login"],
};
