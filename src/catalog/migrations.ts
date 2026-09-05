import type { SqlExecutor } from "./sql-executor.js";

export const migrations = [
  {
    filename: "001_i2_catalog.sql",
    sql: `
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename VARCHAR(255) NOT NULL PRIMARY KEY,
  applied_at DATETIME(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS knowledge_artifacts (
  knowledge_id VARCHAR(255) NOT NULL PRIMARY KEY,
  title VARCHAR(500) NOT NULL,
  artifact_type VARCHAR(100) NOT NULL,
  product VARCHAR(100) NOT NULL,
  domain VARCHAR(100) NOT NULL,
  classification VARCHAR(100) NOT NULL,
  current_status ENUM('stable','draft','deprecated','superseded','archived') NOT NULL,
  source_system ENUM('gitlab','google-drive','okf','schema-catalog') NOT NULL,
  successor_knowledge_id VARCHAR(255) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_artifact_successor FOREIGN KEY (successor_knowledge_id)
    REFERENCES knowledge_artifacts (knowledge_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS knowledge_revisions (
  knowledge_id VARCHAR(255) NOT NULL,
  source_revision VARCHAR(255) NOT NULL,
  source_uri VARCHAR(2048) NOT NULL,
  content_hash VARCHAR(255) NOT NULL,
  section_path VARCHAR(500) NULL,
  page_range VARCHAR(100) NULL,
  line_range VARCHAR(100) NULL,
  verified_at DATETIME(3) NULL,
  stale_after DATETIME(3) NULL,
  valid_from DATETIME(3) NULL,
  valid_until DATETIME(3) NULL,
  PRIMARY KEY (knowledge_id, source_revision),
  CONSTRAINT fk_revision_artifact FOREIGN KEY (knowledge_id)
    REFERENCES knowledge_artifacts (knowledge_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS knowledge_excerpts (
  knowledge_id VARCHAR(255) NOT NULL,
  source_revision VARCHAR(255) NOT NULL,
  excerpt TEXT NOT NULL,
  PRIMARY KEY (knowledge_id, source_revision),
  CONSTRAINT fk_excerpt_revision FOREIGN KEY (knowledge_id, source_revision)
    REFERENCES knowledge_revisions (knowledge_id, source_revision)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS knowledge_acl (
  acl_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  knowledge_id VARCHAR(255) NOT NULL,
  principal_id VARCHAR(255) NULL,
  role_name VARCHAR(255) NULL,
  group_name VARCHAR(255) NULL,
  product VARCHAR(100) NULL,
  domain VARCHAR(100) NULL,
  classification VARCHAR(100) NULL,
  CONSTRAINT fk_acl_artifact FOREIGN KEY (knowledge_id)
    REFERENCES knowledge_artifacts (knowledge_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS knowledge_taxonomies (
  product VARCHAR(100) NOT NULL,
  domain VARCHAR(100) NOT NULL,
  artifact_types JSON NOT NULL,
  concepts JSON NOT NULL,
  PRIMARY KEY (product, domain)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS knowledge_audit_events (
  audit_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  correlation_id VARCHAR(255) NOT NULL,
  principal_id VARCHAR(255) NOT NULL,
  operation VARCHAR(100) NOT NULL,
  filter_keys JSON NOT NULL,
  result_count INT UNSIGNED NOT NULL,
  authorization ENUM('authorized','denied') NOT NULL,
  evidence_status ENUM('sufficient','insufficient') NOT NULL,
  latency_ms INT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,
  },
  {
    filename: "002_i2_indexes.sql",
    sql: `
CREATE INDEX idx_artifact_scope ON knowledge_artifacts (product, domain, current_status, source_system);
CREATE INDEX idx_revision_stale ON knowledge_revisions (stale_after);
CREATE INDEX idx_acl_knowledge_principal ON knowledge_acl (knowledge_id, principal_id);
CREATE INDEX idx_acl_knowledge_role ON knowledge_acl (knowledge_id, role_name);
CREATE INDEX idx_acl_knowledge_group ON knowledge_acl (knowledge_id, group_name);
CREATE INDEX idx_acl_knowledge_product ON knowledge_acl (knowledge_id, product);
CREATE INDEX idx_acl_knowledge_domain ON knowledge_acl (knowledge_id, domain);
CREATE INDEX idx_acl_knowledge_classification ON knowledge_acl (knowledge_id, classification);
CREATE INDEX idx_audit_principal_time ON knowledge_audit_events (principal_id, created_at);
CREATE INDEX idx_audit_operation_time ON knowledge_audit_events (operation, created_at);`,
  },
  {
    filename: "003_i3_chunks.sql",
    sql: `
CREATE TABLE IF NOT EXISTS knowledge_chunks (
  chunk_id VARCHAR(255) NOT NULL PRIMARY KEY,
  knowledge_id VARCHAR(255) NOT NULL,
  source_revision VARCHAR(255) NOT NULL,
  ordinal INT UNSIGNED NOT NULL,
  chunk_text TEXT NOT NULL,
  content_hash VARCHAR(255) NOT NULL,
  character_count INT UNSIGNED NOT NULL,
  token_estimate INT UNSIGNED NOT NULL,
  section_path VARCHAR(500) NULL,
  page_range VARCHAR(100) NULL,
  line_range VARCHAR(100) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_chunk_revision FOREIGN KEY (knowledge_id, source_revision)
    REFERENCES knowledge_revisions (knowledge_id, source_revision),
  UNIQUE KEY uq_chunk_revision_ordinal (knowledge_id, source_revision, ordinal)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS knowledge_index_runs (
  run_id VARCHAR(255) NOT NULL PRIMARY KEY,
  knowledge_id VARCHAR(255) NOT NULL,
  source_revision VARCHAR(255) NOT NULL,
  status ENUM('running','completed','failed') NOT NULL,
  embedding_model VARCHAR(255) NOT NULL,
  vector_dimension INT UNSIGNED NOT NULL,
  chunk_count INT UNSIGNED NOT NULL DEFAULT 0,
  vector_count INT UNSIGNED NOT NULL DEFAULT 0,
  failure_code VARCHAR(100) NULL,
  started_at DATETIME(3) NOT NULL,
  completed_at DATETIME(3) NULL,
  CONSTRAINT fk_index_run_revision FOREIGN KEY (knowledge_id, source_revision)
    REFERENCES knowledge_revisions (knowledge_id, source_revision),
  INDEX idx_index_run_revision (knowledge_id, source_revision, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,
  },
  {
    filename: "004_i3_indexes.sql",
    sql: `
ALTER TABLE knowledge_chunks
  ADD INDEX idx_chunk_revision (knowledge_id, source_revision),
  ADD INDEX idx_chunk_hash (content_hash),
  ADD FULLTEXT INDEX idx_chunk_text (chunk_text);

CREATE INDEX idx_index_run_status ON knowledge_index_runs (status, started_at);`,
  },
] as const;

export const migrationSql = migrations.map((migration) => migration.sql);

export async function runMigrations(executor: SqlExecutor): Promise<void> {
  await executor.execute(
    "CREATE TABLE IF NOT EXISTS schema_migrations (filename VARCHAR(255) NOT NULL PRIMARY KEY, applied_at DATETIME(3) NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
    [],
  );

  for (const migration of migrations) {
    const applied = await executor.query<{ filename: string }>(
      "SELECT filename FROM schema_migrations WHERE filename = ?",
      [migration.filename],
    );
    if (applied.length > 0) continue;
    await executor.execute(migration.sql, []);
    await executor.execute(
      "INSERT INTO schema_migrations (filename, applied_at) VALUES (?, UTC_TIMESTAMP(3))",
      [migration.filename],
    );
  }
}
