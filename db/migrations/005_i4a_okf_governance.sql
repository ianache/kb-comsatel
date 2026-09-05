ALTER TABLE knowledge_artifacts
  MODIFY COLUMN current_status ENUM('stable','draft','stale','deprecated','superseded','archived') NOT NULL;
