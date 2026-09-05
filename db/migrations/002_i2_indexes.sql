CREATE INDEX idx_artifact_scope ON knowledge_artifacts (product, domain, current_status, source_system);
CREATE INDEX idx_revision_stale ON knowledge_revisions (stale_after);
CREATE INDEX idx_acl_lookup ON knowledge_acl (knowledge_id, principal_id, role_name, group_name, product, domain, classification);
CREATE INDEX idx_audit_principal_time ON knowledge_audit_events (principal_id, created_at);
CREATE INDEX idx_audit_operation_time ON knowledge_audit_events (operation, created_at);
