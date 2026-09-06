import { NextResponse } from "next/server";
import { buildAuthorizationUrl, codeChallengeFromVerifier, generateCodeVerifier, generateState } from "@/lib/keycloak";
import { attachPkceCookie } from "@/lib/session";

// Starts the Authorization Code + PKCE flow (RFC 7636) against Keycloak.
// The code_verifier never leaves this server — only its S256 challenge is sent to Keycloak.
export async function GET(): Promise<NextResponse> {
  const codeVerifier = generateCodeVerifier();
  const state = generateState();
  const codeChallenge = codeChallengeFromVerifier(codeVerifier);

  const response = NextResponse.redirect(buildAuthorizationUrl(state, codeChallenge));
  attachPkceCookie(response, codeVerifier, state);
  return response;
}
