import pytest

from app.db.session import _batches, create_batch, start_batch, InvalidBatchTransitionError
from app.models.schemas import BatchStatus


def test_start_batch_from_queued_transitions_to_processing() -> None:
    batch = create_batch(connector_id="c1", source_uri="gitlab://x", artifact_type="markdown", total=10)
    assert batch.status == BatchStatus.queued

    updated = start_batch(batch.id)

    assert updated is not None
    assert updated.status == BatchStatus.processing
    assert updated.id == batch.id


def test_start_batch_from_failed_transitions_to_processing() -> None:
    batch = create_batch(connector_id="c2", source_uri="gitlab://y", artifact_type="markdown", total=5)
    _batches[batch.id] = batch.model_copy(update={"status": BatchStatus.failed})

    updated = start_batch(batch.id)

    assert updated is not None
    assert updated.status == BatchStatus.processing


def test_start_batch_from_processing_raises() -> None:
    batch = create_batch(connector_id="c3", source_uri="gitlab://z", artifact_type="markdown", total=1)
    _batches[batch.id] = batch.model_copy(update={"status": BatchStatus.processing})

    with pytest.raises(InvalidBatchTransitionError):
        start_batch(batch.id)


def test_start_batch_unknown_id_returns_none() -> None:
    assert start_batch("does-not-exist") is None
