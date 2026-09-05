import { expect, it } from "vitest";
import { OidcDiscoveryCache } from "../../src/security/oidc-discovery.js";

it("caches OIDC discovery and returns the validated issuer and JWKS URI", async () => {
  let calls = 0;
  const cache = new OidcDiscoveryCache(
    "https://sso.example.com/realms/kcp",
    300,
    async () => {
      calls += 1;
      return {
        issuer: "https://sso.example.com/realms/kcp",
        jwks_uri:
          "https://sso.example.com/realms/kcp/protocol/openid-connect/certs",
      };
    },
  );

  await expect(cache.get()).resolves.toEqual({
    issuer: "https://sso.example.com/realms/kcp",
    jwksUri: "https://sso.example.com/realms/kcp/protocol/openid-connect/certs",
  });
  await cache.get();
  expect(calls).toBe(1);
});
