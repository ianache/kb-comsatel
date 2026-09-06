from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes_batches import router as batches_router
from app.api.routes_connectors import router as connectors_router
from app.api.routes_gdrive import router as gdrive_router
from app.api.routes_gitlab import router as gitlab_router
from app.core.config import get_settings

settings = get_settings()

app = FastAPI(
    title="Portal KM Comsatel — Ingestion API",
    description="Microservicio de dominio para conectores, fuentes y batches de ingesta de conocimiento.",
    version="0.1.0",
)

# Only the BFF calls this service — restrict CORS to the BFF origin in each environment.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
)

app.include_router(connectors_router, prefix="/api/v1")
app.include_router(batches_router, prefix="/api/v1")
app.include_router(gitlab_router, prefix="/api/v1")
app.include_router(gdrive_router, prefix="/api/v1")


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": settings.service_name}


@app.get("/ready")
async def ready() -> dict[str, str]:
    return {"status": "ready"}
