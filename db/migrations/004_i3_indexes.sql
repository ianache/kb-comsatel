ALTER TABLE knowledge_chunks
  ADD INDEX idx_chunk_revision (knowledge_id, source_revision),
  ADD INDEX idx_chunk_hash (content_hash),
  ADD FULLTEXT INDEX idx_chunk_text (chunk_text);

CREATE INDEX idx_index_run_status ON knowledge_index_runs (status, started_at);
