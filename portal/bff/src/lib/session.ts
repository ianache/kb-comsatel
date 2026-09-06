import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decodeJwt } from "jose";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { refreshTokens } from "./keycloak";

const SESSION_COOKIE = "km_session";
const PKCE_COOKIE = "km_pkce";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export interface SessionData {
  sub: string;
  name: string;
  roles: string[];
  accessToken: string;
  refreshToken?: string;
  idToken: string;
  expiresAt: number;
}

type StoreEntry = { data: SessionData; expiresAt: number };

/**
 * Server-side session store, keyed by an opaque random id carried in the cookie.
 *
 * Real Keycloak access/id/refresh tokens routinely exceed the ~4096-byte per-cookie
 * limit once encrypted and base64-encoded — a cookie holding the encrypted tokens
 * directly gets silently dropped by the browser (no error, Set-Cookie is just
 * ignored). Keeping tokens server-side and only handing the browser an unguessable
 * session id (128 bits of randomness, httpOnly) is the standard BFF pattern and
 * sidesteps the size limit entirely.
 *
 * Backed by a local JSON file (dev only) so sessions survive the frequent dev-server
 * restarts Next.js triggers on file edits (middleware.ts changes in particular force
 * a full restart, which would otherwise wipe a plain in-memory Map on every edit
 * while actively developing this BFF). A real deployment needs a shared store
 * (Redis, etc.) here instead — this file-backed approach is dev-only.
 */
const STORE_FILE = join(process.cwd(), ".session-store.json");

function loadStore(): Map<string, StoreEntry> {
  try {
    if (existsSync(STORE_FILE)) {
      const raw = JSON.parse(readFileSync(STORE_FILE, "utf8")) as Record<string, StoreEntry>;
      return new Map(Object.entries(raw));
    }
  } catch {
    // Corrupt or unreadable store file — start fresh rather than crash the BFF.
  }
  return new Map();
}

function persistStore(): void {
  try {
    writeFileSync(STORE_FILE, JSON.stringify(Object.fromEntries(sessionStore)));
  } catch {
    // Best-effort persistence; an unwritable file just means sessions won't
    // survive the next restart, not a request-time failure.
  }
}

const sessionStore = loadStore();

function purgeExpired(): void {
  const now = Date.now();
  let changed = false;
  for (const [id, entry] of sessionStore) {
    if (entry.expiresAt <= now) {
      sessionStore.delete(id);
      changed = true;
    }
  }
  if (changed) persistStore();
}

/** Route handlers that return a redirect must set cookies on the response object
 * they actually return — mutating the `cookies()` store from next/headers does
 * NOT reliably propagate to a `NextResponse.redirect()` built afterwards. */
export function attachSessionCookie(response: NextResponse, data: SessionData): void {
  purgeExpired();
  const sessionId = randomUUID();
  sessionStore.set(sessionId, { data, expiresAt: Date.now() + SESSION_TTL_MS });
  persistStore();

  // Lax, not Strict: this cookie is first set on the response to the OAuth callback,
  // which the browser reaches via a cross-site top-level navigation (redirected here
  // by Keycloak). Strict cookies set in that context are not reliably sent back on
  // the very next same-site request in some browsers; Lax still blocks the cookie
  // from being sent on cross-site subresource/XHR requests, which is what matters
  // for CSRF protection here.
  response.cookies.set(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function getSession(): Promise<SessionData | null> {
  const sessionId = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!sessionId) return null;

  const entry = sessionStore.get(sessionId);
  if (!entry || entry.expiresAt <= Date.now()) {
    sessionStore.delete(sessionId);
    persistStore();
    return null;
  }

  // The BFF session (12h) outlives the real Keycloak access_token (often a few
  // minutes) by design — refresh it transparently here instead of forcing a
  // re-login every time the access token expires mid-session.
  if (entry.data.expiresAt <= Date.now() + 5_000) {
    if (!entry.data.refreshToken) {
      sessionStore.delete(sessionId);
      persistStore();
      return null;
    }
    try {
      const tokens = await refreshTokens(entry.data.refreshToken);
      const claims = decodeJwt(tokens.access_token) as { exp: number };
      entry.data = {
        ...entry.data,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? entry.data.refreshToken,
        idToken: tokens.id_token ?? entry.data.idToken,
        expiresAt: claims.exp * 1000,
      };
      sessionStore.set(sessionId, entry);
      persistStore();
    } catch {
      // Refresh token expired/revoked too — nothing to do but require a fresh login.
      sessionStore.delete(sessionId);
      persistStore();
      return null;
    }
  }

  return entry.data;
}

export async function clearSessionCookieOn(response: NextResponse): Promise<void> {
  const sessionId = (await cookies()).get(SESSION_COOKIE)?.value;
  if (sessionId) {
    sessionStore.delete(sessionId);
    persistStore();
  }
  response.cookies.delete(SESSION_COOKIE);
}

/**
 * Attaches the PKCE state cookie directly to `response`, for the same reason
 * as attachSessionCookie above.
 */
export function attachPkceCookie(response: NextResponse, codeVerifier: string, state: string): void {
  response.cookies.set(PKCE_COOKIE, JSON.stringify({ codeVerifier, state }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 10,
  });
}

export async function consumePkceCookie(): Promise<{ codeVerifier: string; state: string } | null> {
  const store = await cookies();
  const raw = store.get(PKCE_COOKIE)?.value;
  store.delete(PKCE_COOKIE);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as { codeVerifier: string; state: string };
  } catch {
    return null;
  }
}
