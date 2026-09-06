from fastapi import APIRouter, Body, Depends, HTTPException, status

from app.core.config import Settings, get_settings
from app.core.security import Principal, require_role
from app.core.vault_client import VaultClient, VaultNotConfiguredError

router = APIRouter(prefix="/vault", tags=["vault"])

_WRITE_ROLES = ("km-admin",)


def _get_client(settings: Settings = Depends(get_settings)) -> VaultClient:
    try:
        return VaultClient(settings)
    except VaultNotConfiguredError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc


def _vault_error(exc: Exception) -> HTTPException:
    return HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=f"Vault no disponible: {exc}")


@router.get("/secrets")
async def list_secrets(
    _principal: Principal = Depends(require_role(*_WRITE_ROLES)),
    client: VaultClient = Depends(_get_client),
) -> list[str]:
    try:
        return await client.list_secrets()
    except Exception as exc:  # httpx/network errors — surface as 503, never 500
        raise _vault_error(exc) from exc


@router.get("/secrets/{path}/metadata")
async def get_secret_metadata(
    path: str,
    _principal: Principal = Depends(require_role(*_WRITE_ROLES)),
    client: VaultClient = Depends(_get_client),
) -> dict:
    try:
        return await client.get_secret_metadata(path)
    except Exception as exc:
        raise _vault_error(exc) from exc


@router.put("/secrets/{path}", status_code=status.HTTP_204_NO_CONTENT)
async def write_secret(
    path: str,
    data: dict[str, str] = Body(...),
    _principal: Principal = Depends(require_role(*_WRITE_ROLES)),
    client: VaultClient = Depends(_get_client),
) -> None:
    try:
        await client.write_secret(path, data)
    except Exception as exc:
        raise _vault_error(exc) from exc


@router.delete("/secrets/{path}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_secret(
    path: str,
    _principal: Principal = Depends(require_role(*_WRITE_ROLES)),
    client: VaultClient = Depends(_get_client),
) -> None:
    try:
        await client.delete_secret(path)
    except Exception as exc:
        raise _vault_error(exc) from exc
