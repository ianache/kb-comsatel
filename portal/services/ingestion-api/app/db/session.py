"""In-memory catalog store for local/dev runs.

Swap for a real MySQL-backed repository (see the FR-01..FR-12 data model in
00-REQSPEC/REQSPEC_PRD_Portal_Ingesta_KM.md, section 8) before deploying to OKE.
"""

import re
from datetime import UTC, datetime

from app.models.schemas import (
    BatchStatus,
    Connector,
    ConnectorKind,
    DriveCatalogEntry,
    DriveFolderLink,
    GitLabRepoLink,
    GitLabRepoSelection,
    IngestionBatch,
    SchemaTable,
)

_connectors: dict[str, Connector] = {
    "gitlab-enterprise": Connector(
        id="gitlab-enterprise",
        kind=ConnectorKind.gitlab,
        name="GitLab Enterprise Server",
        base_uri="https://gitlab.internal.comsatel.pe",
        vault_secret_ref="secrets/kb/gitlab",
    ),
    "drive-corp": Connector(
        id="drive-corp",
        kind=ConnectorKind.google_drive,
        name="Google Drive Corporativo",
        base_uri="https://drive.google.com",
        vault_secret_ref="secrets/kb/google-drive",
    ),
}

_batches: dict[str, IngestionBatch] = {}


def list_connectors() -> list[Connector]:
    return list(_connectors.values())


def get_connector(connector_id: str) -> Connector | None:
    return _connectors.get(connector_id)


def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug or "connector"


def create_connector(kind: ConnectorKind, name: str, base_uri: str, vault_secret_ref: str) -> Connector:
    base_slug = _slugify(name)
    connector_id = base_slug
    suffix = 2
    while connector_id in _connectors:
        connector_id = f"{base_slug}-{suffix}"
        suffix += 1

    connector = Connector(
        id=connector_id,
        kind=kind,
        name=name,
        base_uri=base_uri,
        vault_secret_ref=vault_secret_ref,
    )
    _connectors[connector_id] = connector
    return connector


def list_batches() -> list[IngestionBatch]:
    return sorted(_batches.values(), key=lambda b: b.created_at, reverse=True)


def create_batch(connector_id: str, source_uri: str, artifact_type: str, total: int) -> IngestionBatch:
    now = datetime.now(UTC)
    batch_id = f"job-{len(_batches) + 1:05d}"
    batch = IngestionBatch(
        id=batch_id,
        connector_id=connector_id,
        source_uri=source_uri,
        artifact_type=artifact_type,
        processed=0,
        total=total,
        status=BatchStatus.queued,
        created_at=now,
        updated_at=now,
    )
    _batches[batch_id] = batch
    return batch


class InvalidBatchTransitionError(Exception):
    """Raised when start_batch is called on a batch not in `queued` or `failed`."""


def start_batch(batch_id: str) -> IngestionBatch | None:
    existing = _batches.get(batch_id)
    if existing is None:
        return None
    if existing.status not in (BatchStatus.queued, BatchStatus.failed):
        raise InvalidBatchTransitionError(
            f"Batch {batch_id} is in status {existing.status}, cannot start"
        )
    updated = existing.model_copy(update={"status": BatchStatus.processing, "updated_at": datetime.now(UTC)})
    _batches[batch_id] = updated
    return updated


def update_connector(connector_id: str, **fields: object) -> Connector | None:
    existing = _connectors.get(connector_id)
    if existing is None:
        return None
    updated = existing.model_copy(update={k: v for k, v in fields.items() if v is not None})
    _connectors[connector_id] = updated
    return updated


_repo_links: dict[str, GitLabRepoLink] = {}


def list_repo_links(connector_id: str) -> list[GitLabRepoLink]:
    return [link for link in _repo_links.values() if link.connector_id == connector_id]


def link_gitlab_repos(connector_id: str, selections: list[GitLabRepoSelection]) -> list[GitLabRepoLink]:
    already_linked = {link.repo_id for link in _repo_links.values() if link.connector_id == connector_id}
    created: list[GitLabRepoLink] = []
    for selection in selections:
        if selection.repo_id in already_linked:
            continue
        link_id = f"rl-{connector_id}-{selection.repo_id}"
        link = GitLabRepoLink(
            id=link_id,
            connector_id=connector_id,
            repo=selection.repo_name,
            repo_id=selection.repo_id,
            rama=selection.rama,
        )
        _repo_links[link_id] = link
        created.append(link)
    return created


_gdrive_catalog: list[DriveCatalogEntry] = [
    DriveCatalogEntry(id="d1", path="KM/Políticas", tipo="Carpeta compartida"),
    DriveCatalogEntry(id="d2", path="KM/Procesos", tipo="Carpeta compartida"),
    DriveCatalogEntry(id="d3", path="Legal/Contratos", tipo="Restringida"),
    DriveCatalogEntry(id="d4", path="KM/Manuales-Tecnicos", tipo="Carpeta compartida"),
    DriveCatalogEntry(id="d5", path="Finanzas/Arquitectura", tipo="Restringida"),
]

_folder_links: dict[str, DriveFolderLink] = {}


def list_gdrive_catalog() -> list[DriveCatalogEntry]:
    return list(_gdrive_catalog)


def list_folder_links(connector_id: str) -> list[DriveFolderLink]:
    return [link for link in _folder_links.values() if link.connector_id == connector_id]


def link_gdrive_folders(connector_id: str, folder_ids: list[str]) -> list[DriveFolderLink]:
    catalog_by_id = {entry.id: entry for entry in _gdrive_catalog}
    already_linked = {link.id.rsplit("-", 1)[-1] for link in _folder_links.values() if link.connector_id == connector_id}
    created: list[DriveFolderLink] = []
    for folder_id in folder_ids:
        entry = catalog_by_id.get(folder_id)
        if entry is None or folder_id in already_linked:
            continue
        link_id = f"fl-{connector_id}-{folder_id}"
        link = DriveFolderLink(id=link_id, connector_id=connector_id, path=entry.path, tipo=entry.tipo)
        _folder_links[link_id] = link
        created.append(link)
    return created


_schema_tables: list[SchemaTable] = [
    SchemaTable(id="st1", connector_id="", tabla="clientes", columnas=18, motor="MySQL"),
    SchemaTable(id="st2", connector_id="", tabla="facturas", columnas=24, motor="MySQL"),
    SchemaTable(id="st3", connector_id="", tabla="vehiculos", columnas=15, motor="PostgreSQL"),
    SchemaTable(id="st4", connector_id="", tabla="rutas", columnas=9, motor="PostgreSQL"),
]


def list_schema_tables(connector_id: str) -> list[SchemaTable]:
    return [table.model_copy(update={"connector_id": connector_id}) for table in _schema_tables]
