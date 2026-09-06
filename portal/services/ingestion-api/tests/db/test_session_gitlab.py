from app.db.session import link_gitlab_repos, list_repo_links
from app.models.schemas import GitLabRepoSelection


def test_link_gitlab_repos_creates_links_from_selections() -> None:
    selections = [
        GitLabRepoSelection(repo_id="4892", repo_name="telemetry/gps-core", grupo="telemetry", rama="main"),
    ]
    created = link_gitlab_repos("test-connector-1", selections)
    assert len(created) == 1
    assert created[0].repo == "telemetry/gps-core"
    assert created[0].repo_id == "4892"
    assert created[0].rama == "main"

    linked = list_repo_links("test-connector-1")
    assert any(link.repo_id == "4892" for link in linked)


def test_link_gitlab_repos_skips_already_linked() -> None:
    selections = [
        GitLabRepoSelection(repo_id="5012", repo_name="core-api/gateway", grupo="core-api", rama="master"),
    ]
    first = link_gitlab_repos("test-connector-2", selections)
    assert len(first) == 1

    second = link_gitlab_repos("test-connector-2", selections)
    assert len(second) == 0  # already linked, no duplicate created
