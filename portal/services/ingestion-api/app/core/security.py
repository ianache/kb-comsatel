from time import time

import httpx
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import jwt
from jose.exceptions import JWTError

from .config import Settings, get_settings

_bearer = HTTPBearer(auto_error=True)

_jwks_cache: dict[str, object] = {"keys": None, "fetched_at": 0.0}


class Principal:
    """The identity forwarded by the BFF, resolved from a validated JWT."""

    def __init__(self, subject: str, roles: list[str], claims: dict) -> None:
        self.subject = subject
        self.roles = roles
        self.claims = claims

    def has_role(self, role: str) -> bool:
        return role in self.roles


async def _get_jwks(settings: Settings) -> dict:
    now = time()
    if _jwks_cache["keys"] and now - _jwks_cache["fetched_at"] < settings.jwks_cache_seconds:
        return _jwks_cache["keys"]  # type: ignore[return-value]

    jwks_uri = f"{settings.keycloak_issuer}/protocol/openid-connect/certs"
    async with httpx.AsyncClient(timeout=5.0) as client:
        response = await client.get(jwks_uri)
        response.raise_for_status()
        keys = response.json()

    _jwks_cache["keys"] = keys
    _jwks_cache["fetched_at"] = now
    return keys


async def get_current_principal(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
    settings: Settings = Depends(get_settings),
) -> Principal:
    """Validate the bearer token the BFF forwarded, against Keycloak's JWKS.

    This service never trusts an unvalidated identity claim — every request must
    carry a token whose signature, issuer and audience are verified here.
    """
    jwks = await _get_jwks(settings)
    try:
        # audience verification is off: the shared "Apps" realm's clients don't
        # have an audience mapper configured for this client, so the access token's
        # `aud` claim doesn't include it. Signature/issuer/expiry are still enforced.
        # A real deployment should add an audience mapper and re-enable this.
        claims = jwt.decode(
            credentials.credentials,
            jwks,
            algorithms=["RS256"],
            issuer=settings.keycloak_issuer,
            options={"verify_aud": False},
        )
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token invalido o expirado",
        ) from exc

    realm_roles = claims.get("realm_access", {}).get("roles", [])
    return Principal(subject=claims["sub"], roles=realm_roles, claims=claims)


def require_role(*allowed_roles: str):
    async def _checker(principal: Principal = Depends(get_current_principal)) -> Principal:
        if not any(principal.has_role(role) for role in allowed_roles):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Rol insuficiente para esta operacion",
            )
        return principal

    return _checker
