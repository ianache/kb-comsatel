import { NextRequest, NextResponse } from "next/server";

// Local dev only: shell (4200) and micro-ui-ingesta (4201) run on different ports
// than the BFF (3000), so credentialed fetches need explicit CORS. In a real
// deployment the BFF sits behind the same origin/ingress path as the shell and
// this middleware becomes unnecessary — keep the allowlist tight if it's kept.
const DEV_ALLOWED_ORIGINS = new Set(["http://localhost:4200", "http://localhost:4201"]);

export function middleware(request: NextRequest): NextResponse {
  const origin = request.headers.get("origin");
  const allowOrigin = origin && DEV_ALLOWED_ORIGINS.has(origin) ? origin : null;

  if (request.method === "OPTIONS") {
    const response = new NextResponse(null, { status: 204 });
    if (allowOrigin) applyCorsHeaders(response, allowOrigin);
    return response;
  }

  const response = NextResponse.next();
  if (allowOrigin) applyCorsHeaders(response, allowOrigin);
  return response;
}

function applyCorsHeaders(response: NextResponse, origin: string): void {
  response.headers.set("Access-Control-Allow-Origin", origin);
  response.headers.set("Access-Control-Allow-Credentials", "true");
  response.headers.set("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type");
}

// /api/auth/login and /api/auth/callback are only ever reached via full-page
// navigation (redirects), never a fetch() from another origin — and, empirically,
// this middleware running on those requests interfered with the session cookie
// Set-Cookie header on the callback's redirect response. /api/auth/session and
// /api/ingesta/* ARE called via credentialed fetch() from the shell/MicroUI
// origins and still need CORS.
export const config = {
  matcher: ["/api/ingesta/:path*", "/api/auth/session"],
};
