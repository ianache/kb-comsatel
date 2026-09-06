from fastapi import APIRouter, Depends

from app.core.security import Principal, require_role
from app.db.session import list_gdrive_catalog
from app.models.schemas import DriveCatalogEntry

router = APIRouter(prefix="/gdrive", tags=["gdrive"])

_READ_ROLES = ("km-admin", "km-auditor")


@router.get("/catalog", response_model=list[DriveCatalogEntry])
async def get_gdrive_catalog(_principal: Principal = Depends(require_role(*_READ_ROLES))) -> list[DriveCatalogEntry]:
    return list_gdrive_catalog()
