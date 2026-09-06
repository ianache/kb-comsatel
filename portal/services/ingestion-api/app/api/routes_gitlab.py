from fastapi import APIRouter, Depends, HTTPException, status

from app.core.config import Settings, get_settings
from app.core.gitlab_client import GitLabApiError, GitLabClient
from app.core.security import Principal, require_role
from app.core.vault_client import VaultClient, VaultNotConfiguredError
from app.db.session import get_connector, update_connector
from app.models.schemas import Connector, GitLabBranches, GitLabSearchResult, GitLabTestConnectionRequest

router = APIRouter(prefix="/gitlab", tags=["gitlab"])

_READ_ROLES = ("km-admin", "km-auditor")
_WRITE_ROLES = ("km-admin",)


def _require_connector(connector_id: str) -> Connector:
    connector = get_connector(connector_id)
    if connector is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conector no encontrado")
    return connector


async def _resolve_token(vault_secret_ref: str, settings: Settings) -> str:
    try:
        vault_client = VaultClient(settings)
        secret = await vault_client.get_secret_value(vault_secret_ref.removeprefix(f"{settings.vault_kv_path.strip('/')}/"))
        token = secret.get("token")
        if not token:
            raise GitLabApiError("El secreto de Vault no contiene un campo 'token'")
        return token
    except VaultNotConfiguredError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=f"No se pudo leer la credencial de Vault: {exc}") from exc


def _project_to_search_result(project: dict) -> GitLabSearchResult:
    return GitLabSearchResult(
        id=str(project["id"]),
        nombre=project.get("path_with_namespace", ""),
        grupo=project.get("namespace", {}).get("full_path", ""),
    )


@router.get("/connectors/{connector_id}/search", response_model=list[GitLabSearchResult])
async def search_repos(
    connector_id: str,
    q: str = "",
    _principal: Principal = Depends(require_role(*_READ_ROLES)),
    settings: Settings = Depends(get_settings),
) -> list[GitLabSearchResult]:
    query = q.strip()
    if not query:
        return []

    connector = _require_connector(connector_id)
    token = await _resolve_token(connector.vault_secret_ref, settings)
    client = GitLabClient(base_uri=connector.base_uri, token=token)

    try:
        if query.isdigit():
            project = await client.get_project(query)
            projects = [project] if project is not None else []
        else:
            projects = await client.search_projects(query)
    except GitLabApiError as exc:
        update_connector(connector_id, healthy=False)
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=f"No se pudo conectar a GitLab: {exc}") from exc

    if not connector.healthy:
        update_connector(connector_id, healthy=True)
    return [_project_to_search_result(project) for project in projects]


@router.get("/connectors/{connector_id}/repos/{repo_id}/branches", response_model=GitLabBranches)
async def get_repo_branches(
    connector_id: str,
    repo_id: str,
    _principal: Principal = Depends(require_role(*_READ_ROLES)),
    settings: Settings = Depends(get_settings),
) -> GitLabBranches:
    connector = _require_connector(connector_id)
    token = await _resolve_token(connector.vault_secret_ref, settings)
    client = GitLabClient(base_uri=connector.base_uri, token=token)

    try:
        branches = await client.list_branches(repo_id)
    except GitLabApiError as exc:
        update_connector(connector_id, healthy=False)
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=f"No se pudo conectar a GitLab: {exc}") from exc

    if not connector.healthy:
        update_connector(connector_id, healthy=True)

    names = [branch.get("name", "") for branch in branches]
    default = next((branch.get("name", "") for branch in branches if branch.get("default")), names[0] if names else "")
    return GitLabBranches(ramas_disponibles=names, rama_default=default)


@router.post("/test-connection", status_code=status.HTTP_204_NO_CONTENT)
async def test_connection(
    body: GitLabTestConnectionRequest,
    _principal: Principal = Depends(require_role(*_WRITE_ROLES)),
    settings: Settings = Depends(get_settings),
) -> None:
    token = await _resolve_token(body.vault_secret_ref, settings)
    client = GitLabClient(base_uri=body.base_uri, token=token)
    try:
        await client.test_connection()
    except GitLabApiError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=f"No se pudo conectar a GitLab: {exc}") from exc
