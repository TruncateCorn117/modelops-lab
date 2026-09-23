"""Public demos must remain bounded, stateless, and separate from private workspaces."""

import time

import pytest
from fastapi.testclient import TestClient
from modelops.config import ROOT, Settings
from modelops.main import create_app


@pytest.fixture
def demo_settings(tmp_path):
    return Settings(
        database_path=tmp_path / "public-demo.db",
        data_path=ROOT / "data",
        public_demo=True,
        health_interval=3600,
    )


def test_environment_selects_dedicated_demo_database(monkeypatch):
    monkeypatch.delenv("MODEL_OPS_DB", raising=False)
    monkeypatch.setenv("MODEL_OPS_PUBLIC_DEMO", "true")
    monkeypatch.setenv("MODEL_OPS_ROOT_PATH", "/modelops/")
    settings = Settings()
    assert settings.public_demo is True
    assert str(settings.database_path) == "runtime/public-demo.db"
    assert settings.root_path == "/modelops"


def test_public_inference_does_not_persist_input_or_output(demo_settings):
    with TestClient(create_app(demo_settings)) as client:
        health = client.get("/api/health").json()
        assert health["public_demo"] is True
        assert health["auth_required"] is False
        private_text = "设备编号：PRIVATE-INPUT。故障现象：私有测试内容。停机12分钟。"
        for model_id in ("demo-baseline", "demo-noisy"):
            response = client.post("/api/infer", json={"model_id": model_id, "text": private_text})
            assert response.status_code == 200
            assert response.json()["is_simulated"] is True
            assert client.get(f"/api/requests/{response.json()['id']}").status_code == 404
        assert client.get("/api/requests").json() == []
        assert client.get("/api/dashboard").json()["requests_total"] == 0
        assert client.app.state.service.db.all("requests") == []
    assert b"PRIVATE-INPUT" not in demo_settings.database_path.read_bytes()


@pytest.mark.parametrize(
    "method,path",
    [
        ("POST", "/api/models"),
        ("PUT", "/api/models/demo-baseline"),
        ("DELETE", "/api/models/demo-baseline"),
        ("POST", "/api/models/demo-baseline/default"),
        ("POST", "/api/models/demo-baseline/health"),
        ("POST", "/api/datasets"),
        ("POST", "/api/runs"),
        ("POST", "/api/runs/example/cancel"),
    ],
)
def test_public_demo_rejects_mutations_even_with_key(demo_settings, method, path):
    demo_settings.api_key = "test-admin-key"
    with TestClient(create_app(demo_settings)) as client:
        response = client.request(method, path, json={}, headers={"Authorization": "Bearer test-admin-key"})
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "public_demo_read_only"
        assert len(client.app.state.service.db.all("models")) == 2


@pytest.mark.parametrize("model_change", [{"provider": "ollama"}, {"fault_mode": "error"}])
def test_public_inference_rechecks_provider_at_request_time(demo_settings, model_change, monkeypatch):
    from modelops import adapters

    with TestClient(create_app(demo_settings)) as client:
        model = client.app.state.service.db.get("models", "demo-baseline")
        model.update(model_change)
        client.app.state.service.db.put("models", model)

        async def forbidden_call(*args, **kwargs):
            pytest.fail("Restricted public inference must never reach an adapter")

        monkeypatch.setattr(adapters, "infer", forbidden_call)
        response = client.post("/api/infer", json={"model_id": "demo-baseline", "text": "设备报警"})
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "public_demo_provider"


@pytest.mark.parametrize("unsafe_data", ["real_model", "imported_dataset", "private_request", "edited_seed"])
def test_public_demo_refuses_private_database(demo_settings, unsafe_data):
    demo_settings.public_demo = False
    with TestClient(create_app(demo_settings)) as client:
        if unsafe_data == "real_model":
            assert (
                client.post(
                    "/api/models",
                    json={
                        "name": "private model",
                        "provider": "ollama",
                        "base_url": "http://localhost:11434",
                    },
                ).status_code
                == 201
            )
        elif unsafe_data == "imported_dataset":
            data = client.get("/api/datasets/manufacturing-v1/export").json()
            assert client.post("/api/datasets", json=data).status_code == 201
        elif unsafe_data == "private_request":
            assert client.post("/api/infer", json={"text": "private user content"}).status_code == 200
        else:
            data = client.app.state.service.db.get("datasets", "manufacturing-v1")
            data["rows"][0]["text"] = "private source disguised as synthetic data"
            client.app.state.service.db.put("datasets", data)
    demo_settings.public_demo = True
    with pytest.raises(ValueError, match="unapproved data"):
        with TestClient(create_app(demo_settings)):
            pass


@pytest.mark.parametrize("history_kind", ["approved", "unapproved", "changed_output"])
def test_public_demo_checks_prepared_history(demo_settings, history_kind):
    demo_settings.public_demo = False
    with TestClient(create_app(demo_settings)) as client:
        run = client.post(
            "/api/runs",
            json={
                "dataset_id": "manufacturing-v1",
                "model_ids": ["demo-baseline", "demo-noisy"],
                "max_samples": 2,
            },
        ).json()
        for _ in range(200):
            run = client.get(f"/api/runs/{run['id']}").json()
            if run["status"] == "completed":
                break
            time.sleep(0.01)
        assert run["status"] == "completed"
        if history_kind != "unapproved":
            run["public_demo"] = True
            client.app.state.service.db.put("runs", run)
        if history_kind == "changed_output":
            row = client.app.state.service.db.all("requests")[0]
            row["output"]["symptom"] = "private modified output"
            client.app.state.service.db.put("requests", row)
    demo_settings.public_demo = True
    if history_kind == "approved":
        with TestClient(create_app(demo_settings)) as client:
            report = client.get(f"/api/runs/{run['id']}/report?format=json")
            assert report.status_code == 200
            assert len(report.json()["results"]) == 4
    else:
        with pytest.raises(ValueError, match="unapproved data"):
            with TestClient(create_app(demo_settings)):
                pass


@pytest.mark.parametrize("prefix", ["", "/modelops"])
def test_subpath_auth_origin_limits_and_docs(demo_settings, prefix):
    demo_settings.root_path = "/modelops"
    demo_settings.api_key = "subpath-key"
    headers = {"Authorization": "Bearer subpath-key", "Origin": "https://example.test"}
    with TestClient(create_app(demo_settings), base_url="https://example.test") as client:
        assert client.get(f"{prefix}/api/health").json()["public_demo"] is True
        assert client.get(f"{prefix}/api/models").status_code == 401
        assert client.get(f"{prefix}/metrics").status_code == 401
        assert client.get(f"{prefix}/api/models", headers=headers).status_code == 200
        result = client.post(f"{prefix}/api/infer", headers=headers, json={"text": "设备报警"})
        assert result.status_code == 200
        assert result.headers["Cache-Control"] == "no-store"
        assert (
            client.post(
                f"{prefix}/api/infer",
                json={"text": "设备报警"},
                headers={**headers, "Origin": "https://evil.test"},
            ).status_code
            == 403
        )
        assert (
            client.post(
                f"{prefix}/api/infer", content="{}", headers={**headers, "Content-Length": str(13 * 1024**2)}
            ).status_code
            == 413
        )
        docs = client.get(f"{prefix}/docs")
        assert docs.status_code == 200
        assert "/modelops/openapi.json" in docs.text
        schema = client.get(f"{prefix}/openapi.json").json()
        assert {"url": "/modelops"} in schema["servers"]
        assert "/api/infer" in schema["paths"]


def test_subpath_chunked_body_is_bounded(demo_settings):
    demo_settings.root_path = "/modelops"
    with TestClient(create_app(demo_settings)) as client:
        response = client.post(
            "/modelops/api/infer",
            content=(b" " * 1024**2 for _ in range(13)),
            headers={"Content-Type": "application/json"},
        )
        assert response.status_code == 413
        assert client.app.state.service.db.all("requests") == []


@pytest.mark.parametrize("root_path", ["", "/modelops"])
@pytest.mark.parametrize(
    "filename,content,media_type",
    [
        ("index-test.js", 'document.body.dataset.appLoaded = "yes";', "javascript"),
        ("index-test.css", "body { color: rgb(10, 20, 30); }", "text/css"),
    ],
)
def test_frontend_assets_with_preserved_proxy_prefix(
    demo_settings, tmp_path, root_path, filename, content, media_type
):
    # Full-page deployment preserves root_path in the proxy request. API-only
    # tests cannot catch a StaticFiles mount resolving the wrong asset path.
    demo_settings.root_path = root_path
    demo_settings.api_key = "private-api-key"
    demo_settings.frontend_path = tmp_path / "dist"
    assets = demo_settings.frontend_path / "assets"
    assets.mkdir(parents=True)
    (assets / filename).write_text(content)
    asset_url = f"{root_path}/assets/{filename}"
    html = (
        f'<html><head><link rel="stylesheet" href="{root_path}/assets/index-test.css"></head>'
        f'<body><script type="module" src="{root_path}/assets/index-test.js"></script></body></html>'
    )
    (demo_settings.frontend_path / "index.html").write_text(html)

    with TestClient(create_app(demo_settings), base_url="https://example.test") as client:
        page = client.get(f"{root_path}/")
        assert page.status_code == 200
        assert asset_url in page.text
        response = client.get(asset_url)
        assert response.status_code == 200
        assert response.text == content
        assert media_type in response.headers["content-type"]
        assert response.headers["X-Content-Type-Options"] == "nosniff"
        assert client.get(f"{root_path}/api/models").status_code == 401
