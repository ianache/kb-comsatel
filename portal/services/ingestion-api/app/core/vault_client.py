import httpx

from app.core.config import Settings


class VaultNotConfiguredError(Exception):
    """Raised when KM_VAULT_TOKEN is not set — callers should return 503."""


class VaultClient:
    def __init__(self, settings: Settings) -> None:
        if not settings.vault_token:
            raise VaultNotConfiguredError("KM_VAULT_TOKEN no configurado")
        self._addr = settings.vault_addr.rstrip("/")
        # KV v2 URL shape is /v1/<mount>/data|metadata/<secret-path>. The
        # configured KM_VAULT_KV_PATH (e.g. "secrets/kb") is the *engine
        # mount* ("secrets") followed by a fixed sub-path prefix ("kb")
        # under which all this portal's secrets live — not itself a mount.
        kv_path = settings.vault_kv_path.strip("/")
        mount, _, prefix = kv_path.partition("/")
        self._mount = mount
        self._prefix = prefix
        self._headers = {"X-Vault-Token": settings.vault_token}

    def _secret_path(self, path: str) -> str:
        return f"{self._prefix}/{path}" if self._prefix else path

    async def list_secrets(self) -> list[str]:
        url = f"{self._addr}/v1/{self._mount}/metadata/{self._prefix}".rstrip("/")
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.request("LIST", url, headers=self._headers)
        if response.status_code == 404:
            return []
        response.raise_for_status()
        return response.json()["data"]["keys"]

    async def get_secret_metadata(self, path: str) -> dict:
        url = f"{self._addr}/v1/{self._mount}/metadata/{self._secret_path(path)}"
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
        url = f"{self._addr}/v1/{self._mount}/data/{self._secret_path(path)}"
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(url, headers=self._headers, json={"data": data})
        response.raise_for_status()

    async def delete_secret(self, path: str) -> None:
        url = f"{self._addr}/v1/{self._mount}/metadata/{self._secret_path(path)}"
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.delete(url, headers=self._headers)
        if response.status_code not in (204, 404):
            response.raise_for_status()
