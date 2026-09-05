import { expect, it } from "vitest";
import type { SqlExecutor } from "../../src/catalog/sql-executor.js";
import { MySqlKnowledgeRepository } from "../../src/catalog/mysql-repository.js";
import type { AccessPrincipal } from "../../src/domain/schemas.js";

const publicPrincipal: AccessPrincipal = {
  id: "user-1",
  roles: ["developer"],
  groups: [],
  products: ["cgo"],
  domains: ["units"],
  classifications: ["internal"],
};

const publicRow = {
  knowledge_id: "artifact-public-unit-rule",
  title: "Premium unit rule",
  excerpt: "Premium units require a verified identifier.",
  artifact_type: "rule",
  product: "cgo",
  domain: "units",
  classification: "internal",
  current_status: "stable",
  source_system: "gitlab",
  source_uri: "https://gitlab.example.com/rules/premium-unit",
  source_revision: "a1b2c3d4",
  content_hash: "sha256:abc",
  section_path: "Rules/Premium",
  page_range: null,
  line_range: "10-14",
  verified_at: "2026-01-01T00:00:00.000Z",
  stale_after: null,
  successor_knowledge_id: null,
  previous_knowledge_ids: "[]",
  valid_from: null,
  valid_until: null,
  relevance_score: 1,
};

class RecordingSqlExecutor implements SqlExecutor {
  readonly calls: Array<{ sql: string; params: readonly unknown[] }> = [];

  constructor(private readonly rows: object[]) {}

  async query<T>(sql: string, params: readonly unknown[]): Promise<T[]> {
    this.calls.push({ sql, params });
    return this.rows as T[];
  }

  async execute(sql: string, params: readonly unknown[]): Promise<void> {
    this.calls.push({ sql, params });
  }

  async ping(): Promise<void> {}
  async close(): Promise<void> {}
}

it("binds ACL and filter values before returning public results", async () => {
  const executor = new RecordingSqlExecutor([publicRow]);
  const repository = new MySqlKnowledgeRepository(executor);
  const result = await repository.search(
    { query: "premium unit", limit: 8 },
    publicPrincipal,
  );

  expect(result.results[0]?.citation.knowledgeId).toBe(
    "artifact-public-unit-rule",
  );
  expect(executor.calls[0]?.params).toContain("cgo");
  expect(executor.calls[0]?.sql).not.toContain("premium unit");
  expect(executor.calls[0]?.sql).toMatch(/knowledge_acl/i);
});

it("returns null for an unauthorized exact artifact", async () => {
  const executor = new RecordingSqlExecutor([]);
  const repository = new MySqlKnowledgeRepository(executor);

  await expect(
    repository.getArtifact(
      "artifact-restricted-adr",
      undefined,
      publicPrincipal,
    ),
  ).resolves.toBeNull();
  expect(executor.calls[0]?.params).toContain("artifact-restricted-adr");
});

it("hydrates the successor for an exact artifact", async () => {
  const executor = new RecordingSqlExecutor([
    { ...publicRow, successor_knowledge_id: "replacement-rule" },
  ]);
  const repository = new MySqlKnowledgeRepository(executor);

  await expect(
    repository.getArtifact(
      "artifact-public-unit-rule",
      undefined,
      publicPrincipal,
    ),
  ).resolves.toMatchObject({ successorKnowledgeId: "replacement-rule" });
});
