import { describe, expect, it } from "vitest";
import {
  EgressDeniedError,
  createEgressPolicy,
} from "../../src/security/egress-policy.js";

const publicResolver = async (_hostname: string) => ["93.184.216.34"];

function policy(overrides: Partial<Parameters<typeof createEgressPolicy>[0]> = {}) {
  return createEgressPolicy({
    allowHttp: false,
    allowedHosts: {
      gitlab: ["gitlab.example.com"],
      "gitlab-source": ["gitlab.example.com"],
      drive: ["www.googleapis.com"],
      embedding: ["embedding.example.com"],
      qdrant: ["qdrant.example.com"],
      oidc: ["auth.example.com"],
    },
    dnsLookup: publicResolver,
    ...overrides,
  });
}

describe("egress policy", () => {
  it("allows an allowlisted public HTTPS destination", async () => {
    await expect(
      policy().validate("https://gitlab.example.com/api/v4", "gitlab"),
    ).resolves.toEqual(new URL("https://gitlab.example.com/api/v4"));
  });

  it.each([
    "http://127.0.0.1:8080/",
    "https://127.0.0.1/",
    "https://10.0.0.4/",
    "https://172.16.0.4/",
    "https://192.168.1.4/",
    "https://169.254.169.254/latest/meta-data",
    "https://[::1]/",
    "https://[fd00::1]/",
    "https://[fe80::1]/",
    "https://224.0.0.1/",
  ])("rejects private, loopback, link-local, or metadata URL %s", async (url) => {
    await expect(policy().validate(url, "gitlab")).rejects.toMatchObject({
      code: "EGRESS_DENIED",
    });
  });

  it("rejects credentials, non-allowlisted hosts, wrong scheme, and wrong port", async () => {
    await expect(
      policy().validate("https://user:pass@gitlab.example.com/", "gitlab"),
    ).rejects.toBeInstanceOf(EgressDeniedError);
    await expect(
      policy().validate("https://other.example.com/", "gitlab"),
    ).rejects.toMatchObject({ reason: "host_not_allowed" });
    await expect(
      policy().validate("http://gitlab.example.com/", "gitlab"),
    ).rejects.toMatchObject({ reason: "scheme_not_allowed" });
    await expect(
      policy().validate("https://gitlab.example.com:8443/", "gitlab"),
    ).rejects.toMatchObject({ reason: "port_not_allowed" });
  });

  it("supports explicitly enabled development HTTP", async () => {
    await expect(
      policy({ allowHttp: true }).validate(
        "http://gitlab.example.com/",
        "gitlab",
      ),
    ).resolves.toBeInstanceOf(URL);
  });

  it("rejects hostnames resolving to private addresses", async () => {
    const privateDnsPolicy = policy({
      dnsLookup: async () => ["10.0.0.8"],
    });

    await expect(
      privateDnsPolicy.validate("https://gitlab.example.com/", "gitlab"),
    ).rejects.toMatchObject({ reason: "resolved_address_not_allowed" });
  });

  it("revalidates redirects with the same dependency policy", async () => {
    await expect(
      policy().validateRedirect("https://gitlab.example.com/redirect", "gitlab"),
    ).resolves.toBeInstanceOf(URL);
    await expect(
      policy().validateRedirect("https://169.254.169.254/", "gitlab"),
    ).rejects.toMatchObject({ code: "EGRESS_DENIED" });
  });

  it("does not expose path, query, or credentials in denial details", async () => {
    try {
      await policy().validate(
        "https://user:secret@other.example.com/private?token=hidden",
        "gitlab",
      );
      throw new Error("expected validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(EgressDeniedError);
      expect(String(error)).not.toContain("secret");
      expect(String(error)).not.toContain("token=hidden");
      expect(String(error)).not.toContain("/private");
    }
  });
});
