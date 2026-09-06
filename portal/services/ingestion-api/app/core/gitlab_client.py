import httpx


class GitLabApiError(Exception):
    """Raised for any GitLab API failure (auth, network, unexpected status)."""


class GitLabClient:
    def __init__(self, base_uri: str, token: str) -> None:
        self._base = base_uri.rstrip("/")
        self._headers = {"PRIVATE-TOKEN": token}
        self._transport: httpx.BaseTransport | None = None

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(timeout=10.0, transport=self._transport)

    async def search_projects(self, query: str) -> list[dict]:
        url = f"{self._base}/api/v4/projects"
        try:
            async with self._client() as client:
                response = await client.get(url, headers=self._headers, params={"search": query})
            response.raise_for_status()
        except httpx.HTTPError as exc:
            raise GitLabApiError(str(exc)) from exc
        return response.json()

    async def get_project(self, project_id: str) -> dict | None:
        url = f"{self._base}/api/v4/projects/{project_id}"
        try:
            async with self._client() as client:
                response = await client.get(url, headers=self._headers)
            if response.status_code == 404:
                return None
            response.raise_for_status()
        except httpx.HTTPError as exc:
            raise GitLabApiError(str(exc)) from exc
        return response.json()

    async def list_branches(self, project_id: str) -> list[dict]:
        url = f"{self._base}/api/v4/projects/{project_id}/repository/branches"
        try:
            async with self._client() as client:
                response = await client.get(url, headers=self._headers)
            response.raise_for_status()
        except httpx.HTTPError as exc:
            raise GitLabApiError(str(exc)) from exc
        return response.json()

    async def test_connection(self) -> None:
        url = f"{self._base}/api/v4/user"
        try:
            async with self._client() as client:
                response = await client.get(url, headers=self._headers)
            response.raise_for_status()
        except httpx.HTTPError as exc:
            raise GitLabApiError(str(exc)) from exc
