from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.core.security import Principal, get_current_principal
from app.main import app


@pytest.fixture
def admin_client() -> Iterator[TestClient]:
    app.dependency_overrides[get_current_principal] = lambda: Principal(
        subject="test-admin", roles=["km-admin"], claims={}
    )
    client = TestClient(app)
    yield client
    app.dependency_overrides.clear()
