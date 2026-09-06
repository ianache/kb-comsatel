import httpx
import pytest

from app.core.config import Settings
from app.core.vault_client import VaultClient


def _settings(**overrides: object) -> Settings:
    defaults = {
        "vault_addr": "http://vault.test:8200",
        "vault_token": "test-token",
        "vault_kv_path": "secret/kb",
    }
    defaults.update(overrides)
    return Settings(**defaults)


@pytest.mark.asyncio
async def test_get_secret_value_returns_data_map() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/secret/data/kb/gitlab"
        assert request.headers["X-Vault-Token"] == "test-token"
        return httpx.Response(200, json={"data": {"data": {"token": "glpat-abc123"}, "metadata": {}}})

    client = VaultClient(_settings())
    client._transport = httpx.MockTransport(handler)  # patched in Step 3

    result = await client.get_secret_value("gitlab")
    assert result == {"token": "glpat-abc123"}
