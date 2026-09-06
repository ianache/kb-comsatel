import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type EgressDependency =
  | "gitlab"
  | "gitlab-source"
  | "drive"
  | "embedding"
  | "qdrant"
  | "oidc";

export type EgressReason =
  | "invalid_url"
  | "scheme_not_allowed"
  | "host_not_allowed"
  | "credentials_not_allowed"
  | "port_not_allowed"
  | "address_not_allowed"
  | "resolved_address_not_allowed"
  | "dns_resolution_failed";

export class EgressDeniedError extends Error {
  readonly code = "EGRESS_DENIED" as const;

  constructor(
    readonly dependency: EgressDependency,
    readonly reason: EgressReason,
    readonly hostname: string,
  ) {
    super(`Outbound request denied for ${dependency}: ${reason}`);
  }
}

export interface EgressPolicy {
  validate(url: string | URL, dependency: EgressDependency): Promise<URL>;
  validateRedirect(url: string | URL, dependency: EgressDependency): Promise<URL>;
}

export interface EgressPolicyOptions {
  allowedHosts: Record<EgressDependency, string[]>;
  allowHttp: boolean;
  allowPrivateNetworks?: boolean;
  dnsLookup?: (hostname: string) => Promise<string[]>;
}

function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, "");
}

function hostAllowed(hostname: string, allowedHosts: string[]): boolean {
  const normalized = normalizeHost(hostname);
  return allowedHosts.some((allowed) => {
    const candidate = normalizeHost(allowed);
    if (candidate.startsWith("*.")) {
      const suffix = candidate.slice(2);
      return normalized.endsWith(`.${suffix}`) && normalized !== suffix;
    }
    return normalized === candidate;
  });
}

function isPrivateIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet))) {
    return false;
  }
  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb") ||
    normalized.startsWith("ff")
  );
}

function isDisallowedAddress(address: string): boolean {
  const version = isIP(address);
  return version === 4
    ? isPrivateIpv4(address)
    : version === 6
      ? isPrivateIpv6(address)
      : true;
}

function defaultDnsLookup(hostname: string): Promise<string[]> {
  return lookup(hostname, { all: true }).then((entries) =>
    entries.map((entry) => entry.address),
  );
}

function parseUrl(
  input: string | URL,
  dependency: EgressDependency,
): URL {
  try {
    return new URL(input.toString());
  } catch {
    throw new EgressDeniedError(dependency, "invalid_url", "invalid");
  }
}

export function createEgressPolicy({
  allowedHosts,
  allowHttp,
  allowPrivateNetworks = false,
  dnsLookup = defaultDnsLookup,
}: EgressPolicyOptions): EgressPolicy {
  async function validate(input: string | URL, dependency: EgressDependency): Promise<URL> {
    const url = parseUrl(input, dependency);
    const hostname = normalizeHost(url.hostname);

    if (url.username || url.password) {
      throw new EgressDeniedError(dependency, "credentials_not_allowed", hostname);
    }
    if (url.protocol !== "https:" && !(allowHttp && url.protocol === "http:")) {
      throw new EgressDeniedError(dependency, "scheme_not_allowed", hostname);
    }
    if (!hostAllowed(hostname, allowedHosts[dependency] ?? [])) {
      throw new EgressDeniedError(dependency, "host_not_allowed", hostname);
    }

    const expectedPort = url.protocol === "https:" ? "443" : "80";
    if (url.port && url.port !== expectedPort) {
      throw new EgressDeniedError(dependency, "port_not_allowed", hostname);
    }

    const literalAddress = isIP(hostname) !== 0 ? hostname : undefined;
    if (literalAddress && !allowPrivateNetworks && isDisallowedAddress(literalAddress)) {
      throw new EgressDeniedError(dependency, "address_not_allowed", hostname);
    }

    if (!literalAddress && !allowPrivateNetworks) {
      let addresses: string[];
      try {
        addresses = await dnsLookup(hostname);
      } catch {
        throw new EgressDeniedError(dependency, "dns_resolution_failed", hostname);
      }
      if (addresses.length === 0 || addresses.some(isDisallowedAddress)) {
        throw new EgressDeniedError(
          dependency,
          "resolved_address_not_allowed",
          hostname,
        );
      }
    }

    return url;
  }

  return {
    validate,
    validateRedirect: validate,
  };
}
