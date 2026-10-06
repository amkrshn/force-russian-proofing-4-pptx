from fastapi.testclient import TestClient

from app.main import APP_NAME, APP_VERSION, MAX_UPLOAD_BYTES, app


def test_health():
    with TestClient(app) as client:
        response = client.get("/api/health", headers={"host": "localhost"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["service"] == APP_NAME
    assert payload["version"] == APP_VERSION


def test_config_exposes_server_upload_limit():
    with TestClient(app) as client:
        response = client.get("/api/config", headers={"host": "localhost"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["max_upload_bytes"] == MAX_UPLOAD_BYTES
    assert ".pptx" in payload["supported_extensions"]
