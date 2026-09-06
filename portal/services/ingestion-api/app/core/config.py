from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration for the ingestion-api microservice.

    Only Keycloak/JWKS coordinates are needed here — this service never talks to
    Keycloak for login, it only validates bearer tokens forwarded by the BFF.
    """

    model_config = SettingsConfigDict(env_prefix="KM_", env_file=".env", extra="ignore")

    service_name: str = "ingestion-api"
    environment: str = "local"

    keycloak_issuer: str = "https://keycloak.comsatel.internal/realms/comsatel-km-prod"
    keycloak_audience: str = "portal-km-bff"
    jwks_cache_seconds: int = 300

    # Roles per PRD section 5.
    role_admin: str = "km-admin"
    role_curator: str = "km-curator"
    role_operator: str = "km-operator"
    role_auditor: str = "km-auditor"

    vault_addr: str = "http://192.168.100.205:8200"
    vault_token: str = ""
    vault_kv_path: str = "secrets/kb"


@lru_cache
def get_settings() -> Settings:
    return Settings()
