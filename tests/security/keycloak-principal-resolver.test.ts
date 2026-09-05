import { expect, it } from "vitest";
import { KeycloakPrincipalResolver } from "../../src/security/keycloak-principal-resolver.js";

it("maps a valid Keycloak payload to AccessPrincipal", async () => {
  const resolver = new KeycloakPrincipalResolver({
    issuer: "https://sso.example.com/realms/kcp",
    audience: "kcp-client",
    azp: ["kcp-client"],
    clockToleranceSeconds: 5,
    verifyToken: async () => ({
      payload: {
        sub: "user-1",
        azp: "kcp-client",
        realm_access: { roles: ["developer"] },
        groups: ["architecture-reviewers"],
        products: ["cgo"],
        domains: ["units"],
        classifications: ["internal"],
      },
    }),
  });

  await expect(resolver.resolve("Bearer valid-token")).resolves.toEqual({
    id: "user-1",
    roles: ["developer"],
    groups: ["architecture-reviewers"],
    products: ["cgo"],
    domains: ["units"],
    classifications: ["internal"],
  });
});

it("rejects missing bearer authentication without exposing details", async () => {
  const resolver = new KeycloakPrincipalResolver({
    issuer: "https://sso.example.com/realms/kcp",
    audience: "kcp-client",
    azp: ["kcp-client"],
    clockToleranceSeconds: 5,
    verifyToken: async () => ({ payload: { sub: "user-1" } }),
  });

  await expect(resolver.resolve(undefined)).rejects.toMatchObject({
    code: "UNAUTHORIZED",
    message: "Authentication required",
  });
});

it("rejects a token whose authorized party is not configured", async () => {
  const resolver = new KeycloakPrincipalResolver({
    issuer: "https://sso.example.com/realms/kcp",
    audience: "kcp-client",
    azp: ["kcp-client"],
    clockToleranceSeconds: 5,
    verifyToken: async () => ({ payload: { sub: "user-1", azp: "other" } }),
  });

  await expect(resolver.resolve("Bearer token")).rejects.toMatchObject({
    code: "UNAUTHORIZED",
    message: "Invalid bearer token",
  });
});
