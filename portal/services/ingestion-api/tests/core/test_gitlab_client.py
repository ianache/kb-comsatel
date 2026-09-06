import httpx
import pytest

from app.core.gitlab_client import GitLabApiError, GitLabClient


def _client(handler) -> GitLabClient:
    client = GitLabClient(base_uri="https://gitlab.internal.comsatel.pe", token="glpat-abc123")
    client._transport = httpx.MockTransport(handler)
    return client


@pytest.mark.asyncio
async def test_search_projects_calls_search_endpoint() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/v4/projects"
        assert request.url.params["search"] == "gps-core"
        assert request.headers["PRIVATE-TOKEN"] == "glpat-abc123"
        return httpx.Response(
            200,
            json=[
                {
                    "id": 4892,
                    "path_with_namespace": "telemetry/gps-core",
                    "namespace": {"full_path": "telemetry"},
                }
            ],
        )

    client = _client(handler)
    result = await client.search_projects("gps-core")
    assert result == [{"id": 4892, "path_with_namespace": "telemetry/gps-core", "namespace": {"full_path": "telemetry"}}]


@pytest.mark.asyncio
async def test_get_project_by_id() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/v4/projects/4892"
        return httpx.Response(
            200,
            json={"id": 4892, "path_with_namespace": "telemetry/gps-core", "namespace": {"full_path": "telemetry"}},
        )

    client = _client(handler)
    result = await client.get_project("4892")
    assert result is not None
    assert result["id"] == 4892


@pytest.mark.asyncio
async def test_get_project_returns_none_on_404() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"message": "404 Project Not Found"})

    client = _client(handler)
    result = await client.get_project("999999")
    assert result is None


@pytest.mark.asyncio
async def test_list_branches() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/v4/projects/4892/repository/branches"
        return httpx.Response(
            200,
            json=[
                {"name": "main", "default": True},
                {"name": "develop", "default": False},
            ],
        )

    client = _client(handler)
    result = await client.list_branches("4892")
    assert result == [{"name": "main", "default": True}, {"name": "develop", "default": False}]


@pytest.mark.asyncio
async def test_search_projects_raises_on_401() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"message": "401 Unauthorized"})

    client = _client(handler)
    with pytest.raises(GitLabApiError):
        await client.search_projects("anything")


@pytest.mark.asyncio
async def test_test_connection_raises_on_failure() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/v4/user"
        return httpx.Response(401, json={"message": "401 Unauthorized"})

    client = _client(handler)
    with pytest.raises(GitLabApiError):
        await client.test_connection()


@pytest.mark.asyncio
async def test_test_connection_succeeds() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"username": "svc-portal-km"})

    client = _client(handler)
    await client.test_connection()  # must not raise
