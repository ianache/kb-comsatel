from fastapi import APIRouter, Depends

from app.core.security import Principal, require_role
from app.db.session import list_gitlab_catalog
from app.models.schemas import GitLabCatalogEntry

router = APIRouter(prefix="/gitlab", tags=["gitlab"])

_READ_ROLES = ("km-admin", "km-auditor")


@router.get("/catalog", response_model=list[GitLabCatalogEntry])
async def get_gitlab_catalog(_principal: Principal = Depends(require_role(*_READ_ROLES))) -> list[GitLabCatalogEntry]:
    return list_gitlab_catalog()
