import type { AccessPrincipal } from "../domain/schemas.js";
import type { PrincipalResolver } from "../security/principal-resolver.js";
import { SecurityError } from "../security/security-errors.js";

export function extractBearerToken(authorization: string | undefined): string {
  if (!authorization) {
    throw new SecurityError("Authentication required");
  }
  const match = /^Bearer\s+([^\s]+)$/i.exec(authorization.trim());
  if (!match?.[1]) {
    throw new SecurityError("Invalid bearer token");
  }
  return match[1];
}

export async function resolveHttpPrincipal(
  authorization: string | undefined,
  resolver: PrincipalResolver,
): Promise<AccessPrincipal> {
  return resolver.resolve(`Bearer ${extractBearerToken(authorization)}`);
}
