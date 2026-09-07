from app.db.session import _batches, _connectors, _repo_links
from app.models.schemas import Connector, ConnectorKind, GitLabRepoLink


def test_force_ingest_creates_one_batch_per_linked_repo(admin_client) -> None:
    _connectors["fi-c1"] = Connector(
        id="fi-c1", kind=ConnectorKind.gitlab, name="Test", base_uri="https://gitlab.test", vault_secret_ref="secrets/kb/gitlab"
    )
    _repo_links["fi-rl1"] = GitLabRepoLink(id="fi-rl1", connector_id="fi-c1", repo="group/repo-a", repo_id="1", rama="main")
    _repo_links["fi-rl2"] = GitLabRepoLink(id="fi-rl2", connector_id="fi-c1", repo="group/repo-b", repo_id="2", rama="main")

    response = admin_client.post("/api/v1/connectors/fi-c1/force-ingest")

    assert response.status_code == 201
    body = response.json()
    assert len(body) == 2
    assert {b["source_uri"] for b in body} == {"group/repo-a", "group/repo-b"}
    assert all(b["status"] == "queued" for b in body)


def test_force_ingest_no_linked_repos_returns_empty_list(admin_client) -> None:
    _connectors["fi-c2"] = Connector(
        id="fi-c2", kind=ConnectorKind.gitlab, name="Empty", base_uri="https://gitlab.test", vault_secret_ref="secrets/kb/gitlab"
    )

    response = admin_client.post("/api/v1/connectors/fi-c2/force-ingest")

    assert response.status_code == 201
    assert response.json() == []


def test_force_ingest_unknown_connector_returns_404(admin_client) -> None:
    response = admin_client.post("/api/v1/connectors/does-not-exist/force-ingest")
    assert response.status_code == 404
