import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyResult,
} from "jose";
import type { AccessPrincipal } from "../domain/schemas.js";
import type { PrincipalResolver } from "./principal-resolver.js";
import { OidcDiscoveryCache } from "./oidc-discovery.js";
import { SecurityError } from "./security-errors.js";

type VerifiedToken = JWTVerifyResult<JWTPayload>;
type TokenVerifier = (token: string) => Promise<VerifiedToken>;

export interface KeycloakPrincipalResolverOptions {
  issuer: string;
  audience: string;
  azp: string[];
  clockToleranceSeconds: number;
  jwksCacheSeconds?: number;
  discovery?: OidcDiscoveryCache;
  verifyToken?: TokenVerifier;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : typeof value === "string"
      ? [value]
      : [];
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function nestedRoles(payload: JWTPayload, audience: string): string[] {
  const claims = payload as JWTPayload & Record<string, unknown>;
  const realm = claims.realm_access;
  const resource = claims.resource_access;
  const realmRoles =
    typeof realm === "object" && realm !== null
      ? strings((realm as Record<string, unknown>).roles)
      : [];
  const resourceEntry =
    typeof resource === "object" && resource !== null
      ? (resource as Record<string, unknown>)[audience]
      : undefined;
  const resourceRoles =
    typeof resourceEntry === "object" && resourceEntry !== null
      ? strings((resourceEntry as Record<string, unknown>).roles)
      : [];
  return unique([...realmRoles, ...resourceRoles, ...strings(claims.roles)]);
}

export class KeycloakPrincipalResolver implements PrincipalResolver {
  private readonly discovery: OidcDiscoveryCache;
  private remoteJwks: ReturnType<typeof createRemoteJWKSet> | undefined;

  constructor(private readonly options: KeycloakPrincipalResolverOptions) {
    this.discovery =
      options.discovery ??
      new OidcDiscoveryCache(options.issuer, options.jwksCacheSeconds ?? 300);
  }

  async resolve(authorization: string | undefined): Promise<AccessPrincipal> {
    if (!authorization) throw new SecurityError("Authentication required");
    const match = /^Bearer\s+([^\s]+)$/iu.exec(authorization);
    if (!match) throw new SecurityError("Invalid bearer token");

    try {
      const verified = await this.verify(match[1]!);
      const payload = verified.payload;
      if (typeof payload.sub !== "string" || payload.sub.length === 0) {
        throw new Error("Missing subject");
      }
      const azp = typeof payload.azp === "string" ? payload.azp : undefined;
      if (
        this.options.azp.length > 0 &&
        (!azp || !this.options.azp.includes(azp))
      ) {
        throw new Error("Invalid authorized party");
      }
      return {
        id: payload.sub,
        roles: nestedRoles(payload, this.options.audience),
        groups: unique(strings((payload as Record<string, unknown>).groups)),
        products: unique(
          strings((payload as Record<string, unknown>).products),
        ),
        domains: unique(strings((payload as Record<string, unknown>).domains)),
        classifications: unique(
          strings((payload as Record<string, unknown>).classifications),
        ),
      };
    } catch (error) {
      if (error instanceof SecurityError) throw error;
      throw new SecurityError("Invalid bearer token");
    }
  }

  private async verify(token: string): Promise<VerifiedToken> {
    if (this.options.verifyToken) return this.options.verifyToken(token);
    const discovery = await this.discovery.get();
    this.remoteJwks ??= createRemoteJWKSet(new URL(discovery.jwksUri));
    return jwtVerify(token, this.remoteJwks, {
      issuer: discovery.issuer,
      audience: this.options.audience,
      clockTolerance: this.options.clockToleranceSeconds,
    });
  }
}
