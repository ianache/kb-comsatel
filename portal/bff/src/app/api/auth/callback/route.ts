import { decodeJwt } from "jose";
import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForTokens } from "@/lib/keycloak";
import { attachSessionCookie, consumePkceCookie } from "@/lib/session";

interface KeycloakAccessTokenClaims {
  sub: string;
  preferred_username?: string;
  name?: string;
  email?: string;
  exp: number;
  realm_access?: { roles?: string[] };
}

// Completes the Authorization Code + PKCE exchange and issues the BFF's own
// encrypted session cookie. The Keycloak access_token is stored server-side only.
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const baseUrl = process.env.BFF_BASE_URL ?? "http://localhost:3000";

  const pkce = await consumePkceCookie();
  if (!code || !state || !pkce || pkce.state !== state) {
    return NextResponse.redirect(`${baseUrl}/?error=invalid_state`);
  }

  const tokens = await exchangeCodeForTokens(code, pkce.codeVerifier);
  const claims = decodeJwt(tokens.access_token) as unknown as KeycloakAccessTokenClaims;

  const response = NextResponse.redirect(baseUrl);
  await attachSessionCookie(response, {
    sub: claims.sub,
    name: claims.name ?? claims.preferred_username ?? claims.sub,
    email: claims.email ?? "",
    roles: claims.realm_access?.roles ?? [],
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    idToken: tokens.id_token,
    expiresAt: claims.exp * 1000,
  });
  return response;
}
