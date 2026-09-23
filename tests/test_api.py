"""Integration checks for persistent serving, evaluation, and public API boundaries."""

import asyncio
import time

import pytest
from fastapi.testclient import TestClient
from modelops.config import ROOT, Settings
from modelops.main import create_app


@pytest.fixture
def settings(tmp_path):
    return Settings(database_path=tmp_path / "test.db", data_path=ROOT / "data", health_interval=3600)


@pytest.fixture
def client(settings):
    with TestClient(create_app(settings)) as value:
        yield value


def sample(client):
    return client.get("/api/datasets/manufacturing-v1").json()["rows"][0]


def wait_run(client, run_id):
    for _ in range(400):
        run = client.get(f"/api/runs/{run_id}").json()
        if run["status"] not in {"queued", "running"}:
            return run
        time.sleep(0.01)
    pytest.fail("Evaluation did not finish")


def test_seed_and_health(client):
    assert client.get("/api/health").json()["status"] == "ok"
    models = client.get("/api/models").json()
    assert len(models) == 2
    assert sum(m["is_default"] for m in models) == 1
    dataset = client.get("/api/datasets/manufacturing-v1").json()
    assert dataset["count"] >= 120
    assert {r["split"] for r in dataset["rows"]} == {"dev", "test"}
    assert len({r["text"] for r in dataset["rows"]}) == dataset["count"]
    assert client.post("/api/models/demo-baseline/health").json()["status"] == "healthy"


def test_model_crud_and_default(client):
    created = client.post("/api/models", json={"name": "新模型", "provider": "demo"})
    assert created.status_code == 201
    model_id = created.json()["id"]
    assert client.post(f"/api/models/{model_id}/default").json()["is_default"]
    updated = client.put(f"/api/models/{model_id}", json={"name": "禁用", "enabled": False}).json()
    assert not updated["is_default"]
    assert client.post(f"/api/models/{model_id}/default").status_code == 409
    assert client.post("/api/infer", json={"model_id": model_id, "text": "设备报警"}).status_code == 409
    assert client.delete(f"/api/models/{model_id}").status_code == 204
    assert client.delete(f"/api/models/{model_id}").status_code == 404


@pytest.mark.parametrize(
    "overrides",
    [
        {"provider": "openai", "base_url": "http://169.254.169.254/latest"},
        {"provider": "openai", "base_url": "file:///etc/passwd"},
        {"provider": "openai", "base_url": "http://user:pass@localhost:8080"},
        {"api_key_env": "sk-pretend-secret"},
        {"timeout_seconds": 0},
        {"name": "  "},
    ],
)
def test_invalid_model_rejected(client, overrides):
    response = client.post("/api/models", json={"name": "test", **overrides})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"
    assert "sk-pretend-secret" not in response.text


def test_inference_is_persisted_and_traceable(client):
    response = client.post("/api/infer", json={"text": sample(client)["text"]})
    assert response.status_code == 200
    data = response.json()
    assert data["is_simulated"] is True
    assert data["id"] == response.headers["X-Request-ID"]
    detail = client.get(f"/api/requests/{data['id']}").json()
    assert detail["output"] == data["output"]
    assert detail["queue_ms"] >= 0
    assert "text" not in client.get("/api/requests").json()[0]
    assert client.get("/api/dashboard").json()["requests_total"] == 1
    assert "modelops_inference_requests_total" in client.get("/metrics").text


@pytest.mark.parametrize(
    "fault,code,status",
    [("timeout", "timeout", 504), ("invalid_json", "invalid_output", 502), ("error", "upstream_error", 502)],
)
def test_faults_are_logged(client, fault, code, status):
    model = client.post("/api/models", json={"name": fault, "fault_mode": fault, "timeout_seconds": 1}).json()
    result = client.post("/api/infer", json={"model_id": model["id"], "text": "设备报警"})
    assert result.status_code == status
    assert result.json()["error"]["code"] == code
    row = client.get("/api/requests?status=error").json()[0]
    assert row["id"] == result.json()["error"]["request_id"]
    assert row["error_code"] == code


def test_evaluation_snapshots_reports_and_progress(client):
    result = client.post(
        "/api/runs",
        json={
            "dataset_id": "manufacturing-v1",
            "model_ids": ["demo-baseline", "demo-noisy"],
            "max_samples": 8,
            "concurrency": 2,
        },
    )
    assert result.status_code == 202
    run = wait_run(client, result.json()["id"])
    assert run["status"] == "completed"
    assert run["completed"] == run["total"] == 16
    assert len(run["by_model"]) == 2
    assert all(m["is_simulated"] for m in run["by_model"])
    assert run["dataset_sha256"]
    assert run["model_elapsed_seconds"]["demo-baseline"] > 0
    rows = client.get(f"/api/runs/{run['id']}/results").json()
    assert len(rows) == 16
    assert all(r["expected"] and r["score"] for r in rows)
    assert client.get(f"/api/runs/{run['id']}/report?format=json").json()["run"]["id"] == run["id"]
    assert "latency_ms" in client.get(f"/api/runs/{run['id']}/report?format=csv").text
    markdown = client.get(f"/api/runs/{run['id']}/report").text
    assert run["dataset_sha256"] in markdown
    client.put("/api/models/demo-baseline", json={"name": "renamed", "version": "2"})
    assert client.get(f"/api/runs/{run['id']}").json()["model_snapshots"][0]["version"] == "1.0"


def test_cancel_and_busy_guards(client, monkeypatch):
    from modelops import adapters

    original = adapters.infer

    async def slow(*args, **kwargs):
        await asyncio.sleep(0.15)
        return await original(*args, **kwargs)

    monkeypatch.setattr(adapters, "infer", slow)
    created = client.post(
        "/api/runs",
        json={"dataset_id": "manufacturing-v1", "model_ids": ["demo-baseline"], "max_samples": 20},
    ).json()
    assert client.delete("/api/models/demo-baseline").status_code == 409
    assert client.put("/api/models/demo-baseline", json={"name": "edit"}).status_code == 409
    assert (
        client.post(
            "/api/runs", json={"dataset_id": "manufacturing-v1", "model_ids": ["demo-baseline"]}
        ).status_code
        == 409
    )
    cancelled = client.post(f"/api/runs/{created['id']}/cancel").json()
    assert cancelled["status"] == "cancelled"
    assert cancelled["completed"] < cancelled["total"]
    time.sleep(0.2)
    assert client.get(f"/api/runs/{created['id']}").json()["status"] == "cancelled"


def test_dataset_validation_and_export_roundtrip(client):
    exported = client.get("/api/datasets/manufacturing-v1/export").json()
    imported = client.post("/api/datasets", json=exported)
    assert imported.status_code == 201
    original = client.get("/api/datasets/manufacturing-v1").json()
    assert imported.json()["sha256"] == original["sha256"]
    exported["rows"].append(exported["rows"][0])
    assert client.post("/api/datasets", json=exported).status_code == 422
    assert (
        client.post(
            "/api/runs",
            json={"dataset_id": "manufacturing-v1", "model_ids": ["demo-baseline", "demo-baseline"]},
        ).status_code
        == 422
    )
    assert client.post("/api/infer", json={"text": " "}).status_code == 422


def test_auth_protects_data_and_metrics(settings):
    settings.api_key = "test-only-key"
    with TestClient(create_app(settings)) as client:
        assert client.get("/api/health").json()["auth_required"]
        assert client.get("/api/models").status_code == 401
        assert client.get("/metrics").status_code == 401
        assert client.get("/api/models", headers={"Authorization": "Bearer test-only-key"}).status_code == 200
        assert client.get("/api/models", headers={"Authorization": "Bearer bad"}).status_code == 401


def test_cross_origin_mutation_and_large_body(client):
    assert (
        client.post(
            "/api/models", json={"name": "bad"}, headers={"Origin": "https://attacker.invalid"}
        ).status_code
        == 403
    )
    assert (
        client.post("/api/datasets", content="{}", headers={"Content-Length": str(13 * 1024**2)}).status_code
        == 413
    )


def test_restart_preserves_records_and_interrupts_jobs(settings):
    with TestClient(create_app(settings)) as client:
        service = client.app.state.service
        # Simulate a committed running job left by a process crash.
        dataset = service.db.get("datasets", "manufacturing-v1")
        model = service.db.get("models", "demo-baseline")
        service.db.put(
            "runs",
            {
                "id": "crashed",
                "status": "running",
                "started_at": "2026-01-01T00:00:00+00:00",
                "finished_at": None,
                "model_snapshots": [model],
                "model_elapsed_seconds": {},
                "dataset_sha256": dataset["sha256"],
            },
        )
    with TestClient(create_app(settings)) as client:
        run = client.get("/api/runs/crashed").json()
        assert run["status"] == "interrupted"
        assert run["summary"]["throughput_rps"] is None
        assert run["by_model"][0]["throughput_rps"] is None
        assert run["finished_at"]
        assert len(client.get("/api/models").json()) == 2


def test_chunked_payload_limit(client):
    def oversized():
        for _ in range(13):
            yield b" " * 1024 * 1024
        yield b'{"name":"must-not-be-created","provider":"demo"}'

    response = client.post("/api/models", content=oversized(), headers={"Content-Type": "application/json"})
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "payload_too_large"
    assert len(client.get("/api/models").json()) == 2


def test_non_ascii_authorization_is_rejected(settings):
    settings.api_key = "test-only-key"
    with TestClient(create_app(settings)) as client:
        response = client.get("/api/models", headers={b"authorization": b"Bearer \xff"})
        assert response.status_code == 401


def test_openapi_documents_authorization(client):
    schema = client.get("/openapi.json").json()
    assert schema["components"]["securitySchemes"]["AccessKey"]["scheme"] == "bearer"
    assert schema["paths"]["/api/models"]["get"]["security"]
    assert "security" not in schema["paths"]["/api/health"]["get"]


@pytest.mark.asyncio
async def test_stale_health_does_not_overwrite_changed_credentials(settings, monkeypatch):
    from modelops import adapters
    from modelops.schemas import ModelInput
    from modelops.service import Service

    settings.seed = False
    service = Service(settings)
    model = ModelInput(
        name="remote", provider="openai", base_url="http://localhost:11434/v1", api_key_env="OLD_PROVIDER_KEY"
    ).model_dump()
    model.update(id="remote", status="unknown", health_detail="unchecked", last_checked=None)
    service.db.put("models", model)
    started, release = asyncio.Event(), asyncio.Event()

    async def delayed(_):
        started.set()
        await release.wait()
        return {"status": "healthy", "detail": "old credentials accepted"}

    monkeypatch.setattr(adapters, "check_health", delayed)
    pending = asyncio.create_task(service.health("remote"))
    await started.wait()
    current = service.db.get("models", "remote")
    current["api_key_env"] = "NEW_PROVIDER_KEY"
    service.db.put("models", current)
    release.set()
    result = await pending
    assert result["status"] == "unknown"
    assert result["api_key_env"] == "NEW_PROVIDER_KEY"
