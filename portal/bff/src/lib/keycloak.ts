import { createHash, randomBytes } from "node:crypto";

function base64url(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function generateCodeVerifier(): string {
  return base64url(randomBytes(32));
}

export function codeChallengeFromVerifier(verifier: string): string {
  return base64url(createHash("sha256").update(verifier).digest());
}

export function generateState(): string {
  return base64url(randomBytes(16));
}

interface KeycloakConfig {
  issuer: string;
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
}

function getConfig(): KeycloakConfig {
  const issuer = process.env.KEYCLOAK_ISSUER;
  const clientId = process.env.KEYCLOAK_CLIENT_ID;
  if (!issuer || !clientId) {
    throw new Error("KEYCLOAK_ISSUER y KEYCLOAK_CLIENT_ID son obligatorios");
  }
  return {
    issuer,
    clientId,
    clientSecret: process.env.KEYCLOAK_CLIENT_SECRET,
    redirectUri: `${process.env.BFF_BASE_URL ?? "http://localhost:3000"}/api/auth/callback`,
  };
}

export function buildAuthorizationUrl(state: string, codeChallenge: string): string {
  const { issuer, clientId, redirectUri } = getConfig();
  const url = new URL(`${issuer}/protocol/openid-connect/auth`);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid profile email");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token: string;
  expires_in: number;
  token_type: string;
}

/** Authorization Code + PKCE exchange (RFC 7636) — runs server-side only, never in the browser. */
export async function exchangeCodeForTokens(code: string, codeVerifier: string): Promise<TokenResponse> {
  const { issuer, clientId, clientSecret, redirectUri } = getConfig();
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    redirect_uri: redirectUri,
    code,
    code_verifier: codeVerifier,
  });
  if (clientSecret) body.set("client_secret", clientSecret);

  const response = await fetch(`${issuer}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Keycloak token exchange failed: ${response.status} ${detail}`);
  }
  return (await response.json()) as TokenResponse;
}

export async function refreshTokens(refreshToken: string): Promise<TokenResponse> {
  const { issuer, clientId, clientSecret } = getConfig();
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: clientId,
    refresh_token: refreshToken,
  });
  if (clientSecret) body.set("client_secret", clientSecret);

  const response = await fetch(`${issuer}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) {
    throw new Error(`Keycloak token refresh failed: ${response.status}`);
  }
  return (await response.json()) as TokenResponse;
}

export function buildEndSessionUrl(idToken: string): string {
  const { issuer } = getConfig();
  const url = new URL(`${issuer}/protocol/openid-connect/logout`);
  url.searchParams.set("id_token_hint", idToken);
  url.searchParams.set("post_logout_redirect_uri", process.env.BFF_BASE_URL ?? "http://localhost:3000");
  return url.toString();
}
