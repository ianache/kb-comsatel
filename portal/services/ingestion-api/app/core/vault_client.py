import httpx

from app.core.config import Settings


class VaultNotConfiguredError(Exception):
    """Raised when KM_VAULT_TOKEN is not set — callers should return 503."""


class VaultClient:
    def __init__(self, settings: Settings) -> None:
        if not settings.vault_token:
            raise VaultNotConfiguredError("KM_VAULT_TOKEN no configurado")
        self._addr = settings.vault_addr.rstrip("/")
        self._kv_path = settings.vault_kv_path.strip("/")
        self._headers = {"X-Vault-Token": settings.vault_token}

    async def list_secrets(self) -> list[str]:
        url = f"{self._addr}/v1/{self._kv_path}/metadata"
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.request("LIST", url, headers=self._headers)
        if response.status_code == 404:
            return []
        response.raise_for_status()
        return response.json()["data"]["keys"]

    async def get_secret_metadata(self, path: str) -> dict:
        url = f"{self._addr}/v1/{self._kv_path}/metadata/{path}"
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(url, headers=self._headers)
        response.raise_for_status()
        data = response.json()["data"]
        return {
            "path": path,
            "current_version": data.get("current_version"),
            "updated_time": data.get("versions", {})
            .get(str(data.get("current_version")), {})
            .get("created_time"),
        }

    async def write_secret(self, path: str, data: dict[str, str]) -> None:
        url = f"{self._addr}/v1/{self._kv_path}/data/{path}"
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(url, headers=self._headers, json={"data": data})
        response.raise_for_status()

    async def delete_secret(self, path: str) -> None:
        url = f"{self._addr}/v1/{self._kv_path}/metadata/{path}"
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.delete(url, headers=self._headers)
        if response.status_code not in (204, 404):
            response.raise_for_status()
