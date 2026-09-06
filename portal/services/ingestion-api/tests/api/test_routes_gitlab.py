from unittest.mock import AsyncMock, patch

from app.core.gitlab_client import GitLabApiError
from app.db.session import _connectors
from app.models.schemas import Connector, ConnectorKind


def _seed_gitlab_connector() -> None:
    _connectors["gl-test"] = Connector(
        id="gl-test",
        kind=ConnectorKind.gitlab,
        name="GitLab Test",
        base_uri="https://gitlab.test",
        vault_secret_ref="secrets/kb/gitlab-test",
    )


def test_search_by_text_calls_search_projects(admin_client) -> None:
    _seed_gitlab_connector()
    with (
        patch("app.api.routes_gitlab.VaultClient") as mock_vault_cls,
        patch("app.api.routes_gitlab.GitLabClient") as mock_gitlab_cls,
    ):
        mock_vault_cls.return_value.get_secret_value = AsyncMock(return_value={"token": "glpat-x"})
        mock_gitlab_cls.return_value.search_projects = AsyncMock(
            return_value=[{"id": 4892, "path_with_namespace": "telemetry/gps-core", "namespace": {"full_path": "telemetry"}}]
        )

        response = admin_client.get("/api/v1/gitlab/connectors/gl-test/search", params={"q": "gps-core"})

        assert response.status_code == 200
        assert response.json() == [{"id": "4892", "nombre": "telemetry/gps-core", "grupo": "telemetry"}]
        mock_gitlab_cls.return_value.search_projects.assert_awaited_once_with("gps-core")


def test_search_by_numeric_id_calls_get_project(admin_client) -> None:
    _seed_gitlab_connector()
    with (
        patch("app.api.routes_gitlab.VaultClient") as mock_vault_cls,
        patch("app.api.routes_gitlab.GitLabClient") as mock_gitlab_cls,
    ):
        mock_vault_cls.return_value.get_secret_value = AsyncMock(return_value={"token": "glpat-x"})
        mock_gitlab_cls.return_value.get_project = AsyncMock(
            return_value={"id": 4892, "path_with_namespace": "telemetry/gps-core", "namespace": {"full_path": "telemetry"}}
        )

        response = admin_client.get("/api/v1/gitlab/connectors/gl-test/search", params={"q": "4892"})

        assert response.status_code == 200
        assert response.json() == [{"id": "4892", "nombre": "telemetry/gps-core", "grupo": "telemetry"}]
        mock_gitlab_cls.return_value.get_project.assert_awaited_once_with("4892")


def test_search_empty_query_returns_empty_without_calling_gitlab(admin_client) -> None:
    _seed_gitlab_connector()
    with patch("app.api.routes_gitlab.GitLabClient") as mock_gitlab_cls:
        response = admin_client.get("/api/v1/gitlab/connectors/gl-test/search", params={"q": "   "})
        assert response.status_code == 200
        assert response.json() == []
        mock_gitlab_cls.assert_not_called()


def test_search_failure_marks_connector_unhealthy(admin_client) -> None:
    _seed_gitlab_connector()
    with (
        patch("app.api.routes_gitlab.VaultClient") as mock_vault_cls,
        patch("app.api.routes_gitlab.GitLabClient") as mock_gitlab_cls,
    ):
        mock_vault_cls.return_value.get_secret_value = AsyncMock(return_value={"token": "glpat-x"})
        mock_gitlab_cls.return_value.search_projects = AsyncMock(side_effect=GitLabApiError("401 Unauthorized"))

        response = admin_client.get("/api/v1/gitlab/connectors/gl-test/search", params={"q": "gps-core"})

        assert response.status_code == 503
        assert _connectors["gl-test"].healthy is False


def test_branches_endpoint_returns_default_and_list(admin_client) -> None:
    _seed_gitlab_connector()
    with (
        patch("app.api.routes_gitlab.VaultClient") as mock_vault_cls,
        patch("app.api.routes_gitlab.GitLabClient") as mock_gitlab_cls,
    ):
        mock_vault_cls.return_value.get_secret_value = AsyncMock(return_value={"token": "glpat-x"})
        mock_gitlab_cls.return_value.list_branches = AsyncMock(
            return_value=[{"name": "develop", "default": False}, {"name": "main", "default": True}]
        )

        response = admin_client.get("/api/v1/gitlab/connectors/gl-test/repos/4892/branches")

        assert response.status_code == 200
        assert response.json() == {"ramas_disponibles": ["develop", "main"], "rama_default": "main"}


def test_test_connection_success(admin_client) -> None:
    with (
        patch("app.api.routes_gitlab.VaultClient") as mock_vault_cls,
        patch("app.api.routes_gitlab.GitLabClient") as mock_gitlab_cls,
    ):
        mock_vault_cls.return_value.get_secret_value = AsyncMock(return_value={"token": "glpat-x"})
        mock_gitlab_cls.return_value.test_connection = AsyncMock(return_value=None)

        response = admin_client.post(
            "/api/v1/gitlab/test-connection",
            json={"base_uri": "https://gitlab.test", "vault_secret_ref": "secrets/kb/gitlab-test"},
        )

        assert response.status_code == 204


def test_test_connection_failure(admin_client) -> None:
    with (
        patch("app.api.routes_gitlab.VaultClient") as mock_vault_cls,
        patch("app.api.routes_gitlab.GitLabClient") as mock_gitlab_cls,
    ):
        mock_vault_cls.return_value.get_secret_value = AsyncMock(return_value={"token": "glpat-x"})
        mock_gitlab_cls.return_value.test_connection = AsyncMock(side_effect=GitLabApiError("401 Unauthorized"))

        response = admin_client.post(
            "/api/v1/gitlab/test-connection",
            json={"base_uri": "https://gitlab.test", "vault_secret_ref": "secrets/kb/gitlab-test"},
        )

        assert response.status_code == 503
