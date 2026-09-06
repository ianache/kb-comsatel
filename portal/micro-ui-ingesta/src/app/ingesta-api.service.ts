import { Injectable } from "@angular/core";

export interface IngestionBatch {
  id: string;
  connector_id: string;
  source_uri: string;
  artifact_type: string;
  processed: number;
  total: number;
  status: string;
}

export interface Connector {
  id: string;
  kind: string;
  name: string;
  base_uri: string;
  vault_secret_ref: string;
  active: boolean;
  healthy: boolean;
}

export interface CreateConnectorRequest {
  kind: string;
  name: string;
  base_uri: string;
  vault_secret_ref: string;
}

export interface CreateConnectorResult {
  ok: boolean;
  connector?: Connector;
  error?: string;
}

export interface GitLabSearchResult {
  id: string;
  nombre: string;
  grupo: string;
}

export interface GitLabBranches {
  ramas_disponibles: string[];
  rama_default: string;
}

export interface GitLabRepoSelection {
  repo_id: string;
  repo_name: string;
  grupo: string;
  rama: string;
}

export interface GitLabRepoLink {
  id: string;
  connector_id: string;
  repo: string;
  repo_id: string;
  rama: string;
  ruta: string;
  auto_sync: boolean;
  estado: string;
}

export interface DriveCatalogEntry {
  id: string;
  path: string;
  tipo: string;
}

export interface DriveFolderLink {
  id: string;
  connector_id: string;
  path: string;
  tipo: string;
}

export interface SchemaTable {
  id: string;
  connector_id: string;
  tabla: string;
  columnas: number;
  motor: string;
}

export interface UpdateConnectorPayload {
  name?: string;
  base_uri?: string;
  vault_secret_ref?: string;
  active?: boolean;
}

export interface VaultSecretMetadata {
  path: string;
  current_version: number | null;
  updated_time: string | null;
}

const BFF_BASE_URL = (window as unknown as { KM_BFF_URL?: string }).KM_BFF_URL ?? "http://localhost:3000";

// The MicroUI never talks to Keycloak or to ingestion-api directly — every call
// goes through the BFF, which holds the session and injects the bearer token.
@Injectable({ providedIn: "root" })
export class IngestaApiService {
  async listBatches(): Promise<IngestionBatch[]> {
    const response = await fetch(`${BFF_BASE_URL}/api/ingesta/batches`, { credentials: "include" });
    if (!response.ok) return [];
    return (await response.json()) as IngestionBatch[];
  }

  async listConnectors(): Promise<Connector[]> {
    const response = await fetch(`${BFF_BASE_URL}/api/ingesta/connectors`, { credentials: "include" });
    if (!response.ok) return [];
    return (await response.json()) as Connector[];
  }

  async createConnector(payload: CreateConnectorRequest): Promise<CreateConnectorResult> {
    const response = await fetch(`${BFF_BASE_URL}/api/ingesta/connectors`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const detail =
        body && typeof body === "object" && "detail" in body && typeof body.detail === "string"
          ? body.detail
          : `No se pudo crear el conector (HTTP ${response.status}).`;
      return { ok: false, error: detail };
    }
    return { ok: true, connector: body as Connector };
  }

  async searchGitlabRepos(
    connectorId: string,
    query: string,
  ): Promise<{ ok: true; results: GitLabSearchResult[] } | { ok: false; error: string }> {
    const response = await fetch(
      `${BFF_BASE_URL}/api/ingesta/gitlab/${connectorId}/search?q=${encodeURIComponent(query)}`,
      { credentials: "include" },
    );
    if (response.ok) return { ok: true, results: (await response.json()) as GitLabSearchResult[] };
    const body: unknown = await response.json().catch(() => null);
    const detail =
      body && typeof body === "object" && "detail" in body && typeof body.detail === "string"
        ? body.detail
        : `HTTP ${response.status}`;
    return { ok: false, error: detail };
  }

  async getGitlabBranches(
    connectorId: string,
    repoId: string,
  ): Promise<{ ok: true; branches: GitLabBranches } | { ok: false; error: string }> {
    const response = await fetch(`${BFF_BASE_URL}/api/ingesta/gitlab/${connectorId}/branches/${repoId}`, {
      credentials: "include",
    });
    if (response.ok) return { ok: true, branches: (await response.json()) as GitLabBranches };
    const body: unknown = await response.json().catch(() => null);
    const detail =
      body && typeof body === "object" && "detail" in body && typeof body.detail === "string"
        ? body.detail
        : `HTTP ${response.status}`;
    return { ok: false, error: detail };
  }

  async linkGitlabRepos(connectorId: string, selections: GitLabRepoSelection[]): Promise<GitLabRepoLink[]> {
    const response = await fetch(`${BFF_BASE_URL}/api/ingesta/connectors/${connectorId}/repos`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repos: selections }),
    });
    if (!response.ok) return [];
    return (await response.json()) as GitLabRepoLink[];
  }

  async testGitlabConnection(baseUri: string, vaultSecretRef: string): Promise<{ ok: boolean; error?: string }> {
    const response = await fetch(`${BFF_BASE_URL}/api/ingesta/gitlab/test-connection`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base_uri: baseUri, vault_secret_ref: vaultSecretRef }),
    });
    if (response.ok) return { ok: true };
    const body: unknown = await response.json().catch(() => null);
    const detail =
      body && typeof body === "object" && "detail" in body && typeof body.detail === "string"
        ? body.detail
        : `HTTP ${response.status}`;
    return { ok: false, error: detail };
  }

  async listConnectorRepos(connectorId: string): Promise<GitLabRepoLink[]> {
    const response = await fetch(`${BFF_BASE_URL}/api/ingesta/connectors/${connectorId}/repos`, { credentials: "include" });
    if (!response.ok) return [];
    return (await response.json()) as GitLabRepoLink[];
  }

  async listGdriveCatalog(): Promise<DriveCatalogEntry[]> {
    const response = await fetch(`${BFF_BASE_URL}/api/ingesta/gdrive-catalog`, { credentials: "include" });
    if (!response.ok) return [];
    return (await response.json()) as DriveCatalogEntry[];
  }

  async listConnectorFolders(connectorId: string): Promise<DriveFolderLink[]> {
    const response = await fetch(`${BFF_BASE_URL}/api/ingesta/connectors/${connectorId}/folders`, { credentials: "include" });
    if (!response.ok) return [];
    return (await response.json()) as DriveFolderLink[];
  }

  async linkGdriveFolders(connectorId: string, folderIds: string[]): Promise<DriveFolderLink[]> {
    const response = await fetch(`${BFF_BASE_URL}/api/ingesta/connectors/${connectorId}/folders`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder_ids: folderIds }),
    });
    if (!response.ok) return [];
    return (await response.json()) as DriveFolderLink[];
  }

  async listConnectorSchemas(connectorId: string): Promise<SchemaTable[]> {
    const response = await fetch(`${BFF_BASE_URL}/api/ingesta/connectors/${connectorId}/schemas`, { credentials: "include" });
    if (!response.ok) return [];
    return (await response.json()) as SchemaTable[];
  }

  async updateConnector(connectorId: string, payload: UpdateConnectorPayload): Promise<CreateConnectorResult> {
    const response = await fetch(`${BFF_BASE_URL}/api/ingesta/connectors/${connectorId}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const detail =
        body && typeof body === "object" && "detail" in body && typeof body.detail === "string"
          ? body.detail
          : `No se pudo actualizar el conector (HTTP ${response.status}).`;
      return { ok: false, error: detail };
    }
    return { ok: true, connector: body as Connector };
  }

  async listVaultSecrets(): Promise<{ paths: string[] } | { error: string }> {
    const response = await fetch(`${BFF_BASE_URL}/api/ingesta/vault/secrets`, { credentials: "include" });
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      const detail = body && typeof body === "object" && "detail" in body && typeof body.detail === "string" ? body.detail : `HTTP ${response.status}`;
      return { error: detail };
    }
    return { paths: (await response.json()) as string[] };
  }

  async getVaultSecretMetadata(path: string): Promise<VaultSecretMetadata | null> {
    const response = await fetch(`${BFF_BASE_URL}/api/ingesta/vault/secrets/${path}/metadata`, { credentials: "include" });
    if (!response.ok) return null;
    return (await response.json()) as VaultSecretMetadata;
  }

  async writeVaultSecret(path: string, data: Record<string, string>): Promise<{ ok: boolean; error?: string }> {
    const response = await fetch(`${BFF_BASE_URL}/api/ingesta/vault/secrets/${path}`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (response.ok) return { ok: true };
    const body: unknown = await response.json().catch(() => null);
    const detail = body && typeof body === "object" && "detail" in body && typeof body.detail === "string" ? body.detail : `HTTP ${response.status}`;
    return { ok: false, error: detail };
  }

  async deleteVaultSecret(path: string): Promise<boolean> {
    const response = await fetch(`${BFF_BASE_URL}/api/ingesta/vault/secrets/${path}`, {
      method: "DELETE",
      credentials: "include",
    });
    return response.ok;
  }
}
