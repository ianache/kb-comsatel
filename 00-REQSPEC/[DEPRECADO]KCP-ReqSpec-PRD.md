# KNOWLEDGE CONTEXT PLATFORM
## Requirements Specification & Product Requirements Document

**Version:** 1.0 | **Company:** Comsatel | **Date:** August 2026 | **Status:** DEPRECATED

---

## Executive Summary

Knowledge Context Platform is an enterprise application for managing, validating, and publishing AI-ready knowledge extracted from multiple sources (GitLab, Google Drive, databases). The platform sits between source systems and AI agents (Claude Code, OpenAI Codex, Antigravity), providing governance, conflict resolution, and trust scoring.

### Core Principles

- **No automated decisions on knowledge.** Human review mandatory for conflicts, low confidence, or high-impact changes.
- **Audit-trail everything.** Every concept tracks: source, classifier confidence, reviewer, timestamp, changes.
- **Secret management via HashiCorp Vault.** No credentials in code or config.
- **Asynchronous ingestion pipeline.** Real-time webhooks → background jobs → eventual consistency.
- **Semantic versioning.** Knowledge concepts are versioned; AI agents pin to versions.

---

## 1. System Architecture Overview

The platform consists of three main layers:

| Layer | Purpose | Tech Stack |
|-------|---------|-----------|
| **Ingestion** | Extract, classify, map knowledge from sources | Apache Airflow, Python LLM SDK, Trino |
| **Platform API** | CRUD for sources, connections, concepts, reviews | Java Spring Boot, GraphQL/REST |
| **Web UI** | Dashboard, review workflows, governance | React, TypeScript, Tailwind CSS |

---

## 2. Data Model & Schemas

### 2.1 Core Entities

#### Source

```
id: UUID
name: String (e.g., 'CGo Issues')
type: Enum [GITLAB, GDRIVE, MYSQL, POSTGRESQL, MONGODB, LOCAL_FILES]
connection_id: FK → Connection
scope: Enum [GLOBAL, PRODUCT, COMPONENT]
product_id: String (if scope != GLOBAL)
component_id: String (if scope == COMPONENT)
sync_policy: Enum [MANUAL, SCHEDULED, WEBHOOK]
last_sync: Timestamp
status: Enum [HEALTHY, WARNING, ERROR, DISABLED]
created_at: Timestamp
updated_at: Timestamp
```

#### Connection

```
id: UUID
name: String
type: Enum [GITLAB, GDRIVE, MYSQL, POSTGRESQL, MONGODB]
endpoint: String (e.g., https://gitlab.comsatel.io)
secret_reference: String (e.g., secrets/kb/gitlab/corporate)
test_status: Enum [UNTESTED, SUCCESS, FAILED]
test_details: String (error message if failed)
created_at: Timestamp
```

#### KnowledgeConcept (OKF — Ontology Knowledge Format)

```
id: UUID
name: String
type: Enum [BUSINESS_RULE, CAPABILITY, ARCHITECTURE_DECISION, DATA_ENTITY]
scope: Hierarchy (e.g., 'CGo/Units/Unit Management')
source_id: FK → Source
source_reference: String (e.g., GitLab issue URL)
status: Enum [DRAFT, UNDER_REVIEW, STABLE, DEPRECATED]
confidence_score: Float (0-100) [from classifier]
trust_level: Enum [MACHINE_GENERATED, HUMAN_REVIEWED, COMMUNITY_VALIDATED]
freshness: Enum [FRESH, APPROACHING_STALE, STALE]
last_updated: Timestamp
approved_by: String (Knowledge Owner email)
approved_at: Timestamp
content: JSON (structured knowledge)
metadata: JSON (tags, relationships, external_links)
version: Int (semantic versioning)
previous_version_id: FK (self-referential)
```

#### OKFDraft (AI-generated, pending review)

```
id: UUID
source_id: FK → Source
proposed_concept: JSON (same structure as KnowledgeConcept)
confidence_score: Float
generated_at: Timestamp
generated_by: String (e.g., 'claude-sonnet-4')
status: Enum [PENDING, APPROVED, REJECTED, NEEDS_CHANGES]
reviewed_by: String
reviewed_at: Timestamp
review_notes: String
```

#### KnowledgeConflict

```
id: UUID
concept_name: String
source_a_id: FK → Source
source_a_value: String
source_b_id: FK → Source
source_b_value: String
severity: Enum [LOW, MEDIUM, HIGH]
status: Enum [OPEN, IN_REVIEW, RESOLVED, IGNORED]
resolution: String (Knowledge Owner decision: 'chose A', 'merged', etc.)
resolved_at: Timestamp
resolved_by: String
```

---

## 3. API Specification

**Base URL:** `https://kcp-api.comsatel.io/v1`

**Authentication:** Bearer token (JWT, expires 24h) + Vault integration for source credentials

### 3.1 Sources Endpoints

#### GET /sources
Query params: `scope`, `product`, `status`, `type`

**Response:**
```json
{
  "sources": [
    {
      "id": "uuid",
      "name": "CGo Issues",
      "type": "GITLAB",
      "scope": "PRODUCT",
      "status": "HEALTHY",
      "last_sync": "2026-08-29T15:30:00Z",
      "connection_id": "uuid"
    }
  ],
  "total_count": 28
}
```

#### POST /sources

**Body:**
```json
{
  "name": "CGo Issues",
  "type": "GITLAB",
  "connection_id": "uuid",
  "scope": "PRODUCT",
  "product_id": "cgo",
  "component_id": null,
  "sync_policy": "WEBHOOK",
  "review_policy": "HUMAN"
}
```

**Response:** `{ id, status: "CREATED", source }`

#### GET /sources/{id}
**Response:** `{ source }`

#### PUT /sources/{id}

**Body:**
```json
{
  "name": "CGo Issues Updated",
  "status": "HEALTHY",
  "sync_policy": "SCHEDULED"
}
```

**Response:** `{ source }`

#### DELETE /sources/{id}
Soft delete: set `status='DISABLED'`

---

### 3.2 Connections Endpoints

#### POST /connections

**Body:**
```json
{
  "name": "Corporate GitLab",
  "type": "GITLAB",
  "endpoint": "https://gitlab.comsatel.io",
  "secret_reference": "secrets/kb/gitlab/corporate"
}
```

**Response:** `{ id, connection }`

#### POST /connections/{id}/test
**Response:** `{ status: "SUCCESS" | "FAILED", details: "..." }`

#### GET /connections
**Response:** `{ connections: [...] }`

---

### 3.3 Concepts Endpoints

#### GET /concepts
Query params: `type`, `scope`, `status`, `trust_level`, `freshness`, `search`

**Response:**
```json
{
  "concepts": [
    {
      "id": "uuid",
      "name": "Unit Management",
      "type": "CAPABILITY",
      "scope": "CGo/Units",
      "status": "STABLE",
      "trust_level": "HUMAN_REVIEWED",
      "confidence_score": 94
    }
  ],
  "total_count": 821
}
```

#### GET /concepts/{id}
**Response:** `{ concept }`

#### GET /concepts/{id}/history
**Response:**
```json
{
  "versions": [
    {
      "version": 2,
      "updated_at": "2026-08-29T15:35:00Z",
      "updated_by": "knowledge_owner@comsatel.io",
      "changes": { "name": "Old Name", "new_name": "New Name" }
    }
  ]
}
```

#### GET /concepts/{id}/relationships
**Response:**
```json
{
  "depends_on": ["concept-id-1", "concept-id-2"],
  "used_by": ["concept-id-3"]
}
```

---

### 3.4 OKF Drafts & Review

#### GET /drafts
Query params: `status` (PENDING|APPROVED|REJECTED), `confidence_min`

**Response:**
```json
{
  "drafts": [
    {
      "id": "uuid",
      "proposed_concept": { "name": "...", "type": "BUSINESS_RULE" },
      "confidence_score": 94,
      "generated_by": "claude-sonnet-4",
      "status": "PENDING"
    }
  ]
}
```

#### POST /drafts/{id}/review

**Body:**
```json
{
  "decision": "APPROVE" | "REJECT" | "REQUEST_CHANGES",
  "notes": "Approved pending verification of BR-003"
}
```

**Response:** `{ draft, concept (if approved) }`

#### GET /review/{draft_id}

**Response:**
```json
{
  "draft": {
    "proposed_concept": { ... },
    "confidence_score": 94,
    "generated_by": "claude-sonnet-4"
  },
  "source": {
    "original_text": "Unit attributes must include premium flag...",
    "url": "https://gitlab.comsatel.io/cgo/issues/456"
  },
  "similar_concepts": [
    { "concept_id": "uuid", "similarity_score": 0.89 }
  ]
}
```

---

### 3.5 Ingestion Job Endpoints

#### POST /sources/{id}/ingest
Query param: `?sync_policy=MANUAL` (explicit trigger)

**Response:** `{ job_id: "job-123" }`

#### GET /jobs/{job_id}

**Response:**
```json
{
  "job_id": "job-123",
  "source_id": "uuid",
  "started_at": "2026-08-29T15:30:00Z",
  "finished_at": "2026-08-29T15:40:00Z",
  "status": "SUCCESS",
  "pipeline_steps": [
    {
      "step_name": "Extract",
      "status": "SUCCESS",
      "started_at": "2026-08-29T15:30:00Z",
      "finished_at": "2026-08-29T15:31:00Z"
    },
    {
      "step_name": "Classify",
      "status": "SUCCESS",
      "started_at": "2026-08-29T15:31:00Z",
      "finished_at": "2026-08-29T15:35:00Z"
    }
  ],
  "summary": {
    "artifacts_processed": 23,
    "created": 5,
    "updated": 2,
    "no_change": 16,
    "conflicts_detected": 0,
    "drafts_generated": 5
  }
}
```

#### GET /sources/{id}/jobs
Query param: `?limit=10`

**Response:** `{ jobs: [...] }`

---

## 4. Ingestion Pipeline Specification

The pipeline is orchestrated by Apache Airflow. Each DAG processes one source at a time with the following stages:

### Stage 1: Extract

**Input:** Webhook payload or manual trigger

**Task:** Fetch data from source via Connection credentials
- **GitLab:** GraphQL queries for issues, discussions, wiki
- **Google Drive:** Folder tree + document content
- **Database:** SQL query on configured tables

**Output:** Normalized JSON documents

**Error handling:** Retry 3x with exponential backoff; set `source.status='WARNING'` if all fail

---

### Stage 2: Classify

**Input:** Extracted documents

**Task:** Call LLM classifier (Claude Sonnet)
- Determine type (BusinessRule, Capability, ADR, DataEntity)
- Extract entities, tags, related concepts
- Compute confidence score

**Output:** OKFDraft with confidence ≥45%

**Notes:** Low confidence (<45%) logs and flags for manual review; pipeline continues

---

### Stage 3: Map Ontology

**Input:** OKFDraft

**Task:**
- Query existing concepts for scope collision
- Assign hierarchical scope (CGo > Units > Unit Management)
- Identify dependencies & relationships
- Check for contradictions with published concepts

**Output:** Enriched OKFDraft with scope & relationships

**Conflicts:** Create KnowledgeConflict record, mark OKFDraft for manual resolution

---

### Stage 4: Resolve Conflicts

**Input:** OKFDraft with conflicts flag

**Task:**
- If `conflict.severity == HIGH`: Pause job, mark for human review
- If `conflict.severity == MEDIUM`: Allow auto-merge if sources agree on reasoning
- Log all conflicts for audit trail

**Output:** Conflict resolved or escalated

---

### Stage 5: Generate OKF

**Input:** Resolved OKFDraft

**Task:**
- Serialize to final OKF schema (validated against JSON schema)
- Assign version number
- Store to MongoDB

**Output:** OKFDraft with `status='PENDING'` review

---

### Stage 6: Validate

**Input:** OKF document

**Task:**
- JSON schema validation
- Referential integrity (related_concepts exist)
- No orphaned relationships

**Output:** Validation pass/fail

**Failure:** Reject ingestion, alert Knowledge Owner

---

## 5. Webhook Integration (GitLab)

**Endpoint:** `POST /webhooks/gitlab/{source_id}`

**Trigger events:** issues, merge_requests, wiki

**Payload validation:** HMAC SHA256 signature in `X-Gitlab-Token` header

**Response:** `200 OK` with `{ job_id: "..." }` (queued for ingestion)

### Example Payload Structure

```json
{
  "object_kind": "issue",
  "project_id": 123,
  "issue": {
    "id": 456,
    "title": "Unit attributes must include premium flag",
    "description": "Premium units require additional documentation. This affects BR-003.",
    "created_at": "2026-08-29T15:30:00Z",
    "updated_at": "2026-08-29T15:35:00Z",
    "web_url": "https://gitlab.comsatel.io/cgo/issues/456"
  }
}
```

---

## 6. Security & Secrets Management

All source credentials (GitLab token, DB password, etc.) are stored in **HashiCorp Vault**, never in config or logs.

### Pattern

```
Connection.secret_reference = 'secrets/kb/gitlab/corporate'

At runtime:
  1. Airflow task requests token from Vault with service identity
  2. Vault returns short-lived token (TTL 1h)
  3. Credentials are never logged or persisted
  4. After job completes, credentials are discarded
```

### Implementation Details

- Vault enforces: TTL, audit logging, role-based access (only Airflow worker can fetch)
- Service account uses signed JWT for authentication
- Credentials cached in memory only during job execution
- Network calls to Vault are encrypted (mTLS)

---

## 7. Non-Functional Requirements

| Requirement | Target |
|-------------|--------|
| **Availability** | 99.9% SLA (platform API). Ingestion tolerates delays. |
| **Latency** | API p99 < 200ms. Ingestion job < 10min per source. |
| **Throughput** | 10 concurrent ingestion jobs. 1000 API req/min. |
| **Data retention** | Concepts: indefinite. Drafts: 90 days. Audit logs: 1 year. |
| **Audit trail** | Every API call & approval logged with user, timestamp, changeset. |
| **Data consistency** | Eventual consistency for concepts; strong consistency for drafts. |

---

## 8. Development Tech Stack

| Component | Technology |
|-----------|-----------|
| **API Server** | Java 17 + Spring Boot 3.x |
| **ORM** | Hibernate JPA |
| **Database** | PostgreSQL 15 (concepts, metadata). MongoDB (OKF documents). Trino (analytics queries) |
| **Ingestion orchestration** | Apache Airflow 2.6 (DAG-based, Python) |
| **LLM for classification** | Claude Sonnet 4 API (via Anthropic SDK) |
| **Caching** | Redis (session, concept query cache, rate limiting) |
| **Secrets** | HashiCorp Vault 1.14+ |
| **Container orchestration** | Kubernetes (OKE) + Helm |
| **Web UI** | React 18, TypeScript, Tailwind CSS |
| **CI/CD** | GitLab CI/CD |

---

## 9. Error Handling & Resilience

- **Ingestion job failure:** Retry stage 3 times with exponential backoff (1s, 10s, 100s). If still fails, set `source.status='ERROR'`, notify Knowledge Owner.
- **Missing connection secrets:** Log alert, pause source until secrets are updated in Vault.
- **Webhook timeout:** Return 202 Accepted immediately; queue job asynchronously.
- **LLM API down:** Cache fallback to previous classification or manual review required.
- **Database connection pool exhaustion:** Circuit breaker pattern; reject new connections after 30s wait.
- **Validation failure:** Rollback OKFDraft, log detailed error, alert reviewer.

---

## 10. Testing Requirements

- **Unit tests:** 80% code coverage (API, business logic)
- **Integration tests:** Full ingestion pipeline with mock sources
- **E2E tests:** React UI workflows (add source, review knowledge)
- **Load testing:** 1000 concurrent API requests, measure p99 latency
- **Security tests:** SQL injection, XSS, CSRF on all endpoints
- **Vault integration test:** Verify credentials fetching and TTL
- **Webhook signature validation:** Ensure HMAC verification works

---

## 11. Deployment & Infrastructure

### Deployment Model

Containerized (Docker) + Kubernetes (OKE)

### Services

- **kcp-api:** Spring Boot API server (Deployment, 3 replicas, HPA 2-10)
- **kcp-ingestion:** Airflow webserver + scheduler + workers (StatefulSet, 5 worker pods)
- **kcp-ui:** React static site (Nginx sidecar, CDN for assets)
- **PostgreSQL:** RDS managed instance (multi-AZ, automated backups)
- **MongoDB:** DocumentDB managed cluster (encryption at rest)
- **Redis:** ElastiCache cluster (2 replicas, failover enabled)
- **Vault:** Managed service (auto-unsealing)

### Environments

- **dev:** Synthetic data, shorter ingestion intervals
- **staging:** Copy of prod schema, real test data
- **production:** Single region (Lima); backup to another region nightly

---

## 12. Example: Complete Ingestion Flow

### Scenario

Engineer opens GitLab issue in CGo project:
- **Title:** "Unit premium flag must impact documentation"
- **Description:** "Premium units require additional documentation per BR-003. This should be enforced at creation time."

### Timeline

**T+0s:** GitLab sends webhook
```
POST /webhooks/gitlab/source-xyz
{
  "object_kind": "issue",
  "issue": { "id": 789, "title": "...", "description": "..." }
}
```

**T+1s:** Platform receives webhook, returns `202 Accepted` with `job_id='job-123'`
- Async job queued to Airflow

**T+30s:** Airflow job starts, **Extract** stage:
- Fetch issue #789 from GitLab API
- Normalize: extract title, description, author, created_at
- Output: `{ title, body, source_url, metadata }`

**T+35s:** **Classify** stage:
- Call Claude Sonnet: "Classify this text..."
- Response: `{ type: 'BusinessRule', confidence: 94 }`
- Create OKFDraft with confidence=94

**T+40s:** **Map Ontology** stage:
- Query existing concepts for 'BR-003'
- Assign scope: `'CGo/Units/Unit Management'`
- Identify related concepts: ADR-unit-validation
- No conflicts detected

**T+45s:** **Resolve Conflicts** stage:
- No conflicts, proceed

**T+50s:** **Generate OKF** stage:
- Serialize to OKF schema
- Store to MongoDB
- Set `OKFDraft.status = 'PENDING'`

**T+55s:** **Validate** stage:
- JSON schema check: ✓ pass
- Referential integrity: ✓ pass
- Job complete

**T+60s:** OKF Draft appears in platform UI under "Knowledge Drafts"
- Knowledge Owner sees: "Unit Premium Documentation Requirements"
- Confidence: 94% | Waiting for review

**T+5min:** Knowledge Owner reviews
- Reads source (GitLab issue)
- Reads proposed OKF
- Confirms correctness
- Clicks ✓ **APPROVE**

**T+5min 30s:** System publishes:
- OKFDraft → KnowledgeConcept (status='STABLE')
- Indexing for semantic search
- Added to Context Pack 'CGo'
- Audit log: 'Approved by knowledge_owner@comsatel.io'

**T+6min:** Claude Code in CGo project now sees this concept in Context Pack
- When developer asks: "What are the rules for unit creation?"
- → Claude retrieves & surfaces this new knowledge

---

## 13. Acceptance Criteria

✓ Webhook ingestion from GitLab fires and enqueues job within 2 seconds  
✓ Full pipeline (Extract → Publish) completes within 10 minutes for typical source  
✓ Classified concepts have ≥70% accuracy (validated against manual review)  
✓ Conflict detection catches contradictions with ≥95% precision  
✓ Knowledge Owner can approve/reject draft in <30 seconds via UI  
✓ Vault secrets are fetched, never logged or exposed  
✓ Audit trail records every approval with timestamp & user  
✓ OKF Drafts with confidence <70% flag for mandatory human review  
✓ System handles 10 concurrent ingestion jobs without degradation  
✓ API response times: p50 <50ms, p99 <200ms  
✓ React UI renders 18 screens per designs provided  
✓ All endpoints require authentication (JWT or Vault service token)  
✓ Test coverage ≥80% (unit + integration)  

---

## 14. Development Roadmap

### Phase 1: Foundation (Weeks 1-4)
- [ ] Database schema setup (PostgreSQL, MongoDB)
- [ ] Spring Boot API scaffolding (sources, connections endpoints)
- [ ] Airflow DAG skeleton (Extract stage only)
- [ ] Vault integration testing

### Phase 2: Core Pipeline (Weeks 5-8)
- [ ] Classify stage with LLM integration
- [ ] Map Ontology stage
- [ ] OKFDraft storage & retrieval
- [ ] Webhook receiver implementation

### Phase 3: Review & Governance (Weeks 9-12)
- [ ] Knowledge Review UI (React)
- [ ] Conflict detection & resolution
- [ ] Approval workflow
- [ ] Audit logging

### Phase 4: Polish & Testing (Weeks 13-16)
- [ ] Integration tests
- [ ] Load testing
- [ ] Security audit
- [ ] Documentation
- [ ] Production deployment

---

## 15. Success Metrics

| Metric | Target | Measurement |
|--------|--------|------------|
| **Ingestion accuracy** | ≥90% | % of drafts approved without changes |
| **Human review time** | <30s per draft | Time to approve/reject |
| **Pipeline throughput** | 100 sources/day | Sources fully processed daily |
| **API uptime** | 99.9% | SLA compliance |
| **Concept freshness** | <30 days | % of concepts updated recently |
| **Conflict resolution time** | <24h | Time from detection to resolution |

---

## Appendix A: Glossary

- **OKF (Ontology Knowledge Format):** Structured format for storing knowledge concepts
- **Context Pack:** Collection of related concepts published for AI agents
- **Confidence Score:** ML classifier's probability (0-100) that classification is correct
- **Source of Truth:** The authoritative version when conflicts exist
- **Scope:** Hierarchical classification (Global, Product, Component)
- **Trust Level:** Indicator of validation (Machine-Generated, Human-Reviewed, Community-Validated)
- **Freshness:** How recently a concept was updated (Fresh, Approaching Stale, Stale)

---

## Appendix B: Example OKF Document

```json
{
  "id": "ckf-8b3f-11ec-81d3-0242ac130003",
  "name": "Unit Premium Documentation Requirements",
  "type": "BUSINESS_RULE",
  "scope": "CGo/Units/Unit Management",
  "status": "STABLE",
  "confidence_score": 94,
  "trust_level": "HUMAN_REVIEWED",
  "freshness": "FRESH",
  "approved_by": "knowledge_owner@comsatel.io",
  "approved_at": "2026-08-29T15:40:00Z",
  "version": 1,
  "content": {
    "title": "Premium units require additional documentation",
    "description": "When creating a unit with premium=true, the system must enforce: (1) Additional documentation requirement, (2) Extended SLA compliance",
    "related_rules": ["BR-003"],
    "enforcement_point": "Unit creation service",
    "examples": [
      "Premium unit: requires 3 docs minimum",
      "Standard unit: requires 1 doc minimum"
    ]
  },
  "metadata": {
    "tags": ["Unit", "Premium", "Documentation", "SLA"],
    "related_concepts": [
      "ckf-8b3f-11ec-81d3-0242ac130004",
      "ckf-8b3f-11ec-81d3-0242ac130005"
    ],
    "external_links": {
      "gitlab": "https://gitlab.comsatel.io/cgo/issues/456",
      "wiki": "https://wiki.comsatel.io/cgo/unit-premium"
    }
  }
}
```

---

**End of Document**

Generated: August 29, 2026 | Version 1.0
