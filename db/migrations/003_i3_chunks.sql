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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
