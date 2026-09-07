from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field


class ConnectorKind(str, Enum):
    gitlab = "gitlab"
    google_drive = "google_drive"
    upload = "upload"
    schema = "schema"


class SyncMode(str, Enum):
    cron = "cron"
    webhook = "webhook"


class Connector(BaseModel):
    id: str
    kind: ConnectorKind
    name: str
    base_uri: str
    vault_secret_ref: str = Field(description="Referencia Vault, nunca el secreto en si (secrets/kb/...)")
    descripcion: str = ""
    active: bool = True
    healthy: bool = True
    sync_mode: SyncMode = SyncMode.cron
    cron_expr: str | None = None
    webhook_secret_ref: str | None = Field(default=None, description="Referencia Vault del secreto HMAC, nunca el valor")


class CreateConnectorRequest(BaseModel):
    kind: ConnectorKind
    name: str
    base_uri: str
    vault_secret_ref: str = Field(description="Referencia Vault, nunca el secreto en si (secrets/kb/...)")
    descripcion: str = ""


class UpdateConnectorRequest(BaseModel):
    name: str | None = None
    base_uri: str | None = None
    vault_secret_ref: str | None = None
    active: bool | None = None
    sync_mode: SyncMode | None = None
    cron_expr: str | None = None
    webhook_secret_ref: str | None = None


class GitLabSearchResult(BaseModel):
    id: str
    nombre: str
    grupo: str


class GitLabBranches(BaseModel):
    ramas_disponibles: list[str]
    rama_default: str


class GitLabTestConnectionRequest(BaseModel):
    base_uri: str
    vault_secret_ref: str


class GitLabRepoLink(BaseModel):
    id: str
    connector_id: str
    repo: str
    repo_id: str
    rama: str
    ruta: str = "/"
    auto_sync: bool = True
    estado: str = "Sincronizado"


class GitLabRepoSelection(BaseModel):
    repo_id: str
    repo_name: str
    grupo: str
    rama: str


class LinkGitlabReposRequest(BaseModel):
    repos: list[GitLabRepoSelection]


class DriveCatalogEntry(BaseModel):
    id: str
    path: str
    tipo: str


class DriveFolderLink(BaseModel):
    id: str
    connector_id: str
    path: str
    tipo: str


class LinkDriveFoldersRequest(BaseModel):
    folder_ids: list[str]


class SchemaTable(BaseModel):
    id: str
    connector_id: str
    tabla: str
    columnas: int
    motor: str


class BatchStatus(str, Enum):
    queued = "queued"
    processing = "processing"
    indexed = "indexed"
    draft_created = "draft_created"
    failed = "failed"
    skipped = "skipped"
    stale = "stale"


class IngestionBatch(BaseModel):
    id: str
    connector_id: str
    source_uri: str
    artifact_type: str
    processed: int
    total: int
    status: BatchStatus
    created_at: datetime
    updated_at: datetime


class TriggerIngestionRequest(BaseModel):
    connector_id: str
    paths: list[str] = Field(default_factory=list, description="Repos/proyectos o carpetas Drive explicitas")
    incremental: bool = True


class ErrorRecord(BaseModel):
    id: str
    batch_id: str
    error_code: str
    cause: str
    retry_count: int
    dlq: bool
