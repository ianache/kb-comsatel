import { KcpError } from "../domain/errors.js";
import type {
  AccessPrincipal,
  ArtifactLineage,
  KnowledgeArtifact,
  KnowledgeExcerpt,
  KnowledgeFilters,
  Provenance,
  SearchKnowledgeInput,
  SearchKnowledgeResult,
  StaleConcept,
  Taxonomy,
} from "../domain/schemas.js";
import type { KnowledgeRepository } from "./repository.js";
import type { SqlExecutor } from "./sql-executor.js";
import {
  mapArtifact,
  mapCitation,
  mapExcerpt,
  mapLineage,
  mapProvenance,
  mapStale,
  mapTaxonomy,
  type KnowledgeRow,
} from "./mysql-row-mappers.js";

const columns = `a.knowledge_id, a.title, a.artifact_type, a.product, a.domain,
  a.classification, a.current_status, a.source_system, a.successor_knowledge_id,
  r.source_revision, r.source_uri, r.content_hash, r.section_path, r.page_range,
  r.line_range, r.verified_at, r.stale_after, r.valid_from, r.valid_until,
  e.excerpt`;

function placeholders(values: readonly unknown[]): string {
  return values.map(() => "?").join(", ");
}

function aclPredicate(principal: AccessPrincipal): {
  sql: string;
  params: unknown[];
} {
  const values = [
    principal.id,
    ...principal.roles,
    ...principal.groups,
    ...principal.products,
    ...principal.domains,
    ...principal.classifications,
  ];
  const placeholdersSql = placeholders(values);
  return {
    sql: `(NOT EXISTS (SELECT 1 FROM knowledge_acl denied_acl WHERE denied_acl.knowledge_id = a.knowledge_id)
      OR EXISTS (SELECT 1 FROM knowledge_acl allowed_acl
        WHERE allowed_acl.knowledge_id = a.knowledge_id
            AND (allowed_acl.principal_id IN (${placeholders([principal.id])})
            OR allowed_acl.role_name IN (${placeholders(principal.roles) || "NULL"})
            OR allowed_acl.group_name IN (${placeholders(principal.groups) || "NULL"})
            OR allowed_acl.product IN (${placeholders(principal.products) || "NULL"})
            OR allowed_acl.domain IN (${placeholders(principal.domains) || "NULL"})
            OR allowed_acl.classification IN (${placeholders(principal.classifications) || "NULL"}))))`,
    params: values,
  };
}

function filtersPredicate(filters: KnowledgeFilters): {
  sql: string;
  params: unknown[];
} {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const addIn = (column: string, values: string[] | undefined) => {
    if (values && values.length > 0) {
      clauses.push(`${column} IN (${placeholders(values)})`);
      params.push(...values);
    }
  };
  addIn("a.product", filters.product);
  addIn("a.domain", filters.domain);
  addIn("a.artifact_type", filters.artifactType);
  addIn("a.current_status", filters.status);
  addIn("a.source_system", filters.sourceSystem);
  if (filters.verifiedOnly) clauses.push("r.verified_at IS NOT NULL");
  if (!filters.staleAllowed) {
    clauses.push("(r.stale_after IS NULL OR r.stale_after > UTC_TIMESTAMP(3))");
  }
  return { sql: clauses.length === 0 ? "1=1" : clauses.join(" AND "), params };
}

function safeDatabaseError(error: unknown): KcpError {
  if (error instanceof KcpError) return error;
  return new KcpError("INTERNAL_ERROR", "Knowledge catalog unavailable");
}

export class MySqlKnowledgeRepository implements KnowledgeRepository {
  constructor(private readonly executor: SqlExecutor) {}

  async search(
    input: SearchKnowledgeInput,
    principal: AccessPrincipal,
  ): Promise<SearchKnowledgeResult> {
    try {
      const filter = filtersPredicate(input.filters ?? {});
      const acl = aclPredicate(principal);
      const terms = input.query.split(/\s+/u).filter(Boolean);
      const termSql =
        terms.length === 0
          ? "1=1"
          : terms
              .map(() => "(a.title LIKE ? OR e.excerpt LIKE ?)")
              .join(" AND ");
      const termParams = terms.flatMap((term) => [`%${term}%`, `%${term}%`]);
      const rows = await this.executor.query<KnowledgeRow>(
        `SELECT ${columns}, 1 AS relevance_score
         FROM knowledge_artifacts a
         JOIN knowledge_revisions r ON r.knowledge_id = a.knowledge_id
         JOIN knowledge_excerpts e ON e.knowledge_id = r.knowledge_id AND e.source_revision = r.source_revision
         WHERE ${termSql} AND ${filter.sql} AND ${acl.sql}
         ORDER BY relevance_score DESC, a.knowledge_id ASC LIMIT ?`,
        [...termParams, ...filter.params, ...acl.params, input.limit],
      );
      return {
        results: rows.map((row) => ({
          knowledgeId: String(row.knowledge_id),
          excerpt: String(row.excerpt),
          relevanceScore: Number(row.relevance_score ?? 0),
          trust: row.verified_at ? "verified" : "unverified",
          citation: mapCitation(row),
        })),
        appliedFilters: input.filters ?? {},
        evidenceStatus: rows.length === 0 ? "insufficient" : "sufficient",
        warnings: [],
      };
    } catch (error) {
      throw safeDatabaseError(error);
    }
  }

  async getExcerpt(
    id: string,
    principal: AccessPrincipal,
  ): Promise<KnowledgeExcerpt | null> {
    const row = await this.one(id, principal);
    return row === null ? null : mapExcerpt(row);
  }

  async getLineage(
    id: string,
    principal: AccessPrincipal,
  ): Promise<ArtifactLineage | null> {
    const row = await this.one(id, principal);
    return row === null ? null : mapLineage(row);
  }

  async getProvenance(
    id: string,
    principal: AccessPrincipal,
  ): Promise<Provenance | null> {
    const row = await this.one(id, principal);
    return row === null ? null : mapProvenance(row);
  }

  async listStale(
    filters: KnowledgeFilters,
    principal: AccessPrincipal,
  ): Promise<StaleConcept[]> {
    try {
      const filter = filtersPredicate({ ...filters, staleAllowed: true });
      const acl = aclPredicate(principal);
      const rows = await this.executor.query<KnowledgeRow>(
        `SELECT ${columns} FROM knowledge_artifacts a
         JOIN knowledge_revisions r ON r.knowledge_id = a.knowledge_id
         JOIN knowledge_excerpts e ON e.knowledge_id = r.knowledge_id AND e.source_revision = r.source_revision
         WHERE r.stale_after IS NOT NULL AND r.stale_after <= UTC_TIMESTAMP(3)
           AND ${filter.sql} AND ${acl.sql}`,
        [...filter.params, ...acl.params],
      );
      return rows.map(mapStale);
    } catch (error) {
      throw safeDatabaseError(error);
    }
  }

  async getArtifact(
    id: string,
    sourceRevision: string | undefined,
    principal: AccessPrincipal,
  ): Promise<KnowledgeArtifact | null> {
    const row = await this.one(id, principal, sourceRevision);
    return row === null ? null : mapArtifact(row);
  }

  async getTaxonomy(
    domain: string,
    principal: AccessPrincipal,
  ): Promise<Taxonomy | null> {
    try {
      const acl = aclPredicate(principal);
      const rows = await this.executor.query<KnowledgeRow>(
        `SELECT t.product, t.domain, t.artifact_types, t.concepts
         FROM knowledge_taxonomies t
         WHERE t.domain = ? AND EXISTS (
           SELECT 1 FROM knowledge_artifacts a WHERE a.domain = t.domain AND ${acl.sql}
         ) LIMIT 1`,
        [domain, ...acl.params],
      );
      return rows.length === 0 ? null : mapTaxonomy(rows[0]!);
    } catch (error) {
      throw safeDatabaseError(error);
    }
  }

  private async one(
    id: string,
    principal: AccessPrincipal,
    sourceRevision?: string,
  ): Promise<KnowledgeRow | null> {
    try {
      const acl = aclPredicate(principal);
      const revisionClause =
        sourceRevision === undefined ? "" : " AND r.source_revision = ?";
      const rows = await this.executor.query<KnowledgeRow>(
        `SELECT ${columns} FROM knowledge_artifacts a
         JOIN knowledge_revisions r ON r.knowledge_id = a.knowledge_id
         JOIN knowledge_excerpts e ON e.knowledge_id = r.knowledge_id AND e.source_revision = r.source_revision
         WHERE a.knowledge_id = ?${revisionClause} AND ${acl.sql}
         ORDER BY r.source_revision DESC LIMIT 1`,
        [
          id,
          ...(sourceRevision === undefined ? [] : [sourceRevision]),
          ...acl.params,
        ],
      );
      return rows[0] ?? null;
    } catch (error) {
      throw safeDatabaseError(error);
    }
  }
}
