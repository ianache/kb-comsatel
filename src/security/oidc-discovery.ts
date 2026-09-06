export interface OidcConfiguration {
  issuer: string;
  jwksUri: string;
}

import type { CircuitBreaker, OperationDeadline } from "../ops/resilience.js";
import { createOperationDeadline } from "../ops/resilience.js";
import type { EgressPolicy } from "./egress-policy.js";

type DiscoveryFetcher = (
  url: string,
  init?: RequestInit,
) => Promise<unknown>;

function validUrl(value: unknown, name: string): string {
  if (typeof value !== "string") throw new Error(`Invalid OIDC ${name}`);
  try {
    return new URL(value).toString().replace(/\/$/u, "");
  } catch {
    throw new Error(`Invalid OIDC ${name}`);
  }
}

async function defaultFetcher(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error("OIDC discovery unavailable");
  return response.json();
}

export class OidcDiscoveryCache {
  private cached: { value: OidcConfiguration; expiresAt: number } | undefined;
  private pending: Promise<OidcConfiguration> | undefined;

  constructor(
    private readonly issuer: string,
    private readonly cacheSeconds: number,
    private readonly fetcher: DiscoveryFetcher = defaultFetcher,
    private readonly options: {
      egressPolicy?: EgressPolicy;
      breaker?: CircuitBreaker;
      deadline?: OperationDeadline;
      timeoutMs?: number;
    } = {},
  ) {}

  async get(): Promise<OidcConfiguration> {
    if (this.cached && this.cached.expiresAt > Date.now())
      return this.cached.value;
    this.pending ??= this.load();
    try {
      return await this.pending;
    } finally {
      this.pending = undefined;
    }
  }

  async refresh(): Promise<OidcConfiguration> {
    this.cached = undefined;
    return this.get();
  }

  private async load(): Promise<OidcConfiguration> {
    const discoveryUrl = `${this.issuer}/.well-known/openid-configuration`;
    const validatedUrl = this.options.egressPolicy
      ? await this.options.egressPolicy.validate(discoveryUrl, "oidc")
      : discoveryUrl;
    const deadline =
      this.options.deadline?.child() ??
      createOperationDeadline(this.options.timeoutMs ?? 10_000);
    const request = () =>
      this.fetcher(validatedUrl.toString(), {
        signal: deadline.signal(),
        headers: { accept: "application/json" },
      });
    let raw: unknown;
    try {
      raw = await (this.options.breaker
        ? this.options.breaker.execute(request)
        : request());
    } finally {
      deadline.dispose();
    }
    if (typeof raw !== "object" || raw === null)
      throw new Error("Invalid OIDC discovery");
    const record = raw as Record<string, unknown>;
    const value = {
      issuer: validUrl(record.issuer, "issuer"),
      jwksUri: validUrl(record.jwks_uri, "jwks_uri"),
    };
    if (value.issuer !== this.issuer.replace(/\/$/u, "")) {
      throw new Error("OIDC issuer mismatch");
    }
    this.cached = { value, expiresAt: Date.now() + this.cacheSeconds * 1000 };
    return value;
  }
}
