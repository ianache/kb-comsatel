from app.db.session import _connectors
from app.models.schemas import Connector, ConnectorKind


def _seed_gitlab_connector() -> None:
    _connectors["gl-link-test"] = Connector(
        id="gl-link-test",
        kind=ConnectorKind.gitlab,
        name="GitLab Link Test",
        base_uri="https://gitlab.test",
        vault_secret_ref="secrets/kb/gitlab-test",
    )


def test_post_connector_repos_with_selections_payload(admin_client) -> None:
    _seed_gitlab_connector()
    response = admin_client.post(
        "/api/v1/connectors/gl-link-test/repos",
        json={"repos": [{"repo_id": "4892", "repo_name": "telemetry/gps-core", "grupo": "telemetry", "rama": "main"}]},
    )
    assert response.status_code == 201
    body = response.json()
    assert len(body) == 1
    assert body[0]["repo"] == "telemetry/gps-core"
    assert body[0]["rama"] == "main"
