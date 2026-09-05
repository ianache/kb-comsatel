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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
