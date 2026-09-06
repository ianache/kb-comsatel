from fastapi import APIRouter, Depends, HTTPException, status

from app.core.security import Principal, require_role
from app.db.session import create_batch, get_connector, list_batches
from app.models.schemas import IngestionBatch, TriggerIngestionRequest

router = APIRouter(prefix="/batches", tags=["batches"])

_READ_ROLES = ("km-admin", "km-curator", "km-operator", "km-auditor")
_TRIGGER_ROLES = ("km-admin", "km-operator")


@router.get("", response_model=list[IngestionBatch])
async def get_batches(_principal: Principal = Depends(require_role(*_READ_ROLES))) -> list[IngestionBatch]:
    return list_batches()


@router.post("", response_model=IngestionBatch, status_code=status.HTTP_201_CREATED)
async def trigger_batch(
    body: TriggerIngestionRequest,
    _principal: Principal = Depends(require_role(*_TRIGGER_ROLES)),
) -> IngestionBatch:
    connector = get_connector(body.connector_id)
    if connector is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conector no encontrado")

    source_uri = ", ".join(body.paths) if body.paths else connector.base_uri
    return create_batch(
        connector_id=connector.id,
        source_uri=source_uri,
        artifact_type="markdown+pdf",
        total=0,
    )
