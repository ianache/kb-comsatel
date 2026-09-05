export interface OidcConfiguration {
  issuer: string;
  jwksUri: string;
}

type DiscoveryFetcher = (url: string) => Promise<unknown>;

function validUrl(value: unknown, name: string): string {
  if (typeof value !== "string") throw new Error(`Invalid OIDC ${name}`);
  try {
    return new URL(value).toString().replace(/\/$/u, "");
  } catch {
    throw new Error(`Invalid OIDC ${name}`);
  }
}

async function defaultFetcher(url: string): Promise<unknown> {
  const response = await fetch(url, {
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
    const raw = await this.fetcher(
      `${this.issuer}/.well-known/openid-configuration`,
    );
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
