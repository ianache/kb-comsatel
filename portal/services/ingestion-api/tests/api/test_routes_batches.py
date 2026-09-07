from app.db.session import _batches, create_batch


def test_start_batch_success(admin_client) -> None:
    batch = create_batch(connector_id="c1", source_uri="gitlab://x", artifact_type="markdown", total=10)

    response = admin_client.post(f"/api/v1/batches/{batch.id}/start")

    assert response.status_code == 200
    assert response.json()["status"] == "processing"


def test_start_batch_unknown_id_returns_404(admin_client) -> None:
    response = admin_client.post("/api/v1/batches/does-not-exist/start")
    assert response.status_code == 404


def test_start_batch_invalid_transition_returns_409(admin_client) -> None:
    batch = create_batch(connector_id="c2", source_uri="gitlab://y", artifact_type="markdown", total=1)
    _batches[batch.id] = batch.model_copy(update={"status": "processing"})

    response = admin_client.post(f"/api/v1/batches/{batch.id}/start")

    assert response.status_code == 409
