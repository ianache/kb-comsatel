from fastapi import APIRouter, Depends, HTTPException, status

from app.core.security import Principal, require_role
from app.db.session import (
    create_connector,
    get_connector,
    link_gitlab_repos,
    link_gdrive_folders,
    list_connectors,
    list_folder_links,
    list_repo_links,
    list_schema_tables,
    update_connector,
)
from app.models.schemas import (
    Connector,
    CreateConnectorRequest,
    DriveFolderLink,
    GitLabRepoLink,
    LinkDriveFoldersRequest,
    LinkGitlabReposRequest,
    SchemaTable,
    UpdateConnectorRequest,
)

router = APIRouter(prefix="/connectors", tags=["connectors"])

_READ_ROLES = ("km-admin", "km-auditor")
_WRITE_ROLES = ("km-admin",)


def _require_connector(connector_id: str) -> Connector:
    connector = get_connector(connector_id)
    if connector is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conector no encontrado")
    return connector


@router.get("", response_model=list[Connector])
async def get_connectors(_principal: Principal = Depends(require_role(*_READ_ROLES))) -> list[Connector]:
    return list_connectors()


@router.post("", response_model=Connector, status_code=status.HTTP_201_CREATED)
async def post_connector(
    body: CreateConnectorRequest,
    _principal: Principal = Depends(require_role(*_WRITE_ROLES)),
) -> Connector:
    return create_connector(
        kind=body.kind,
        name=body.name,
        base_uri=body.base_uri,
        vault_secret_ref=body.vault_secret_ref,
    )


@router.patch("/{connector_id}", response_model=Connector)
async def patch_connector(
    connector_id: str,
    body: UpdateConnectorRequest,
    _principal: Principal = Depends(require_role(*_WRITE_ROLES)),
) -> Connector:
    _require_connector(connector_id)
    updated = update_connector(
        connector_id,
        name=body.name,
        base_uri=body.base_uri,
        vault_secret_ref=body.vault_secret_ref,
        active=body.active,
    )
    assert updated is not None
    return updated


@router.get("/{connector_id}/repos", response_model=list[GitLabRepoLink])
async def get_connector_repos(
    connector_id: str,
    _principal: Principal = Depends(require_role(*_READ_ROLES)),
) -> list[GitLabRepoLink]:
    _require_connector(connector_id)
    return list_repo_links(connector_id)


@router.post("/{connector_id}/repos", response_model=list[GitLabRepoLink], status_code=status.HTTP_201_CREATED)
async def post_connector_repos(
    connector_id: str,
    body: LinkGitlabReposRequest,
    _principal: Principal = Depends(require_role(*_WRITE_ROLES)),
) -> list[GitLabRepoLink]:
    _require_connector(connector_id)
    return link_gitlab_repos(connector_id, body.repo_ids, body.branch_by_id)


@router.get("/{connector_id}/folders", response_model=list[DriveFolderLink])
async def get_connector_folders(
    connector_id: str,
    _principal: Principal = Depends(require_role(*_READ_ROLES)),
) -> list[DriveFolderLink]:
    _require_connector(connector_id)
    return list_folder_links(connector_id)


@router.post("/{connector_id}/folders", response_model=list[DriveFolderLink], status_code=status.HTTP_201_CREATED)
async def post_connector_folders(
    connector_id: str,
    body: LinkDriveFoldersRequest,
    _principal: Principal = Depends(require_role(*_WRITE_ROLES)),
) -> list[DriveFolderLink]:
    _require_connector(connector_id)
    return link_gdrive_folders(connector_id, body.folder_ids)


@router.get("/{connector_id}/schemas", response_model=list[SchemaTable])
async def get_connector_schemas(
    connector_id: str,
    _principal: Principal = Depends(require_role(*_READ_ROLES)),
) -> list[SchemaTable]:
    _require_connector(connector_id)
    return list_schema_tables(connector_id)
