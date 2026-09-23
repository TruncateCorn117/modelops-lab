import json

import httpx
import pytest
from modelops import adapters


@pytest.fixture
def output():
    return {
        "equipment_id": "EQ-001",
        "equipment": "贴标机",
        "production_line": "3号产线",
        "reported_at": "2026-09-12",
        "fault_code": "E17",
        "category": "electrical",
        "symptom": "传感器信号间歇丢失",
        "action_taken": "复位后恢复",
        "downtime_minutes": 18,
    }


@pytest.fixture
def model():
    return {
        "provider": "ollama",
        "model_name": "test-model",
        "base_url": "http://localhost:11434",
        "timeout_seconds": 10,
        "temperature": 0.2,
        "max_tokens": 512,
        "fault_mode": "none",
        "api_key_env": None,
    }


@pytest.fixture
def install_transport(monkeypatch):
    real_client = httpx.AsyncClient

    def install(handler):
        options = []

        def factory(**kwargs):
            options.append(kwargs.copy())
            return real_client(**kwargs, transport=httpx.MockTransport(handler))

        monkeypatch.setattr(adapters.httpx, "AsyncClient", factory)
        return options

    return install


async def test_ollama_payload_response_and_transport_policy(model, output, install_transport):
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(
            200,
            json={
                "message": {"content": json.dumps(output)},
                "done": True,
                "prompt_eval_count": 100,
                "eval_count": 45,
            },
        )

    options = install_transport(handler)
    result = await adapters.infer(model, "a ticket")
    sent = json.loads(requests[0].content)
    assert str(requests[0].url) == "http://localhost:11434/api/chat"
    assert sent["model"] == "test-model"
    assert sent["stream"] is False
    assert sent["options"] == {"temperature": 0.2, "num_predict": 512}
    assert set(sent["format"]["required"]) == set(adapters.OUTPUT_FIELDS)
    assert sent["messages"][1] == {"role": "user", "content": "a ticket"}
    assert options[0]["follow_redirects"] is False
    assert options[0]["trust_env"] is False
    assert result["output"] == output
    assert result["input_tokens"] == 100 and result["output_tokens"] == 45
    assert result["latency_ms"] >= 0
    assert result["is_simulated"] is False


async def test_openai_environment_key_and_prefix(model, output, monkeypatch, install_transport):
    monkeypatch.setenv("MODEL_OPS_ALLOWED_HOSTS", "localhost,models.example.test")
    monkeypatch.setenv("TEST_PROVIDER_KEY", "test-secret")
    model.update(
        provider="openai", base_url="https://models.example.test/gateway/v1", api_key_env="TEST_PROVIDER_KEY"
    )

    def handler(request):
        assert request.headers["Authorization"] == "Bearer test-secret"
        assert str(request.url) == "https://models.example.test/gateway/v1/chat/completions"
        payload = json.loads(request.content)
        assert payload["response_format"]["type"] == "json_schema"
        assert payload["response_format"]["json_schema"]["strict"] is True
        assert set(payload["response_format"]["json_schema"]["schema"]["required"]) == set(
            adapters.OUTPUT_FIELDS
        )
        assert payload["max_tokens"] == 512
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": json.dumps(output)}, "finish_reason": "stop"}],
                "usage": {"prompt_tokens": 9, "completion_tokens": 21},
            },
        )

    install_transport(handler)
    result = await adapters.infer(model, "data")
    assert result["output"] == output
    assert result["output_tokens"] == 21
    assert "test-secret" not in json.dumps(result)
    assert model["api_key_env"] == "TEST_PROVIDER_KEY"


@pytest.mark.parametrize(
    "url",
    [
        "https://unapproved.example/v1",
        "http://localhost.evil.test/v1",
        "file:///etc/passwd",
        "http://secret@localhost",
        "http://localhost/path?token=secret",
        "http://localhost/path#fragment",
        "http://localhost:99999",
        "http://localhost\\@evil.test",
    ],
)
async def test_disallowed_destinations_never_connect(model, url, install_transport):
    model["base_url"] = url

    def handler(request):
        pytest.fail("Invalid endpoint must not result in a network request")

    install_transport(handler)
    with pytest.raises(adapters.AdapterError) as exc:
        await adapters.infer(model, "ticket")
    assert exc.value.code == "configuration_error"


async def test_redirect_not_followed_or_body_exposed(model, install_transport):
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(
            307, headers={"Location": "https://attacker.test/steal"}, text="private secret body"
        )

    install_transport(handler)
    with pytest.raises(adapters.AdapterError) as exc:
        await adapters.infer(model, "private ticket")
    assert len(calls) == 1
    assert exc.value.code == "upstream_error"
    assert "307" in exc.value.message
    assert "private" not in exc.value.message and "attacker" not in exc.value.message


@pytest.mark.parametrize(
    "error,code,status",
    [
        (httpx.ReadTimeout("private URL"), "timeout", 504),
        (httpx.ConnectError("private URL"), "connection_error", 502),
    ],
)
async def test_network_failure_is_sanitized_no_retry(model, error, code, status, install_transport):
    calls = []

    def handler(request):
        calls.append(request)
        raise error

    install_transport(handler)
    with pytest.raises(adapters.AdapterError) as exc:
        await adapters.infer(model, "private ticket")
    assert exc.value.code == code and exc.value.status_code == status
    assert "private" not in exc.value.message
    assert len(calls) == 1


@pytest.mark.parametrize(
    "mutation",
    [
        lambda value: value.pop("fault_code"),
        lambda value: value.update(downtime_minutes=-1),
        lambda value: value.update(downtime_minutes=True),
        lambda value: value.update(downtime_minutes="18"),
        lambda value: value.update(category="unknown"),
        lambda value: value.update(extra="unexpected"),
    ],
)
async def test_invalid_structured_output(model, output, mutation, install_transport):
    mutation(output)
    install_transport(lambda request: httpx.Response(200, json={"message": {"content": json.dumps(output)}}))
    with pytest.raises(adapters.AdapterError, match="JSON") as exc:
        await adapters.infer(model, "ticket")
    assert exc.value.code == "invalid_output"


@pytest.mark.parametrize("body", [b"not JSON", b"[]", b'{"message": null}', b'{"message":{"content":null}}'])
async def test_malformed_provider_envelope(model, body, install_transport):
    install_transport(lambda request: httpx.Response(200, content=body))
    with pytest.raises(adapters.AdapterError) as exc:
        await adapters.infer(model, "ticket")
    assert exc.value.code == "invalid_output"


async def test_output_size_limit(model, install_transport, monkeypatch):
    monkeypatch.setattr(adapters, "MAX_RESPONSE_BYTES", 16)
    install_transport(lambda request: httpx.Response(200, content=b"a" * 17))
    with pytest.raises(adapters.AdapterError) as exc:
        await adapters.infer(model, "ticket")
    assert exc.value.code == "invalid_output"


async def test_key_reference_must_exist(model, monkeypatch):
    model["api_key_env"] = "MISSING_KEY_FOR_TEST"
    monkeypatch.delenv("MISSING_KEY_FOR_TEST", raising=False)
    with pytest.raises(adapters.AdapterError) as exc:
        await adapters.infer(model, "ticket")
    assert exc.value.code == "configuration_error"


async def test_health_requires_listed_model_and_is_not_inference(model, install_transport):
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(200, json={"models": [{"name": "test-model:latest"}]})

    install_transport(handler)
    health = await adapters.check_health(model)
    assert health["status"] == "healthy"
    assert "未执行试推理" in health["detail"]
    assert requests[0].method == "GET"
    assert requests[0].url.path == "/api/tags"
    model["model_name"] = "uninstalled"
    assert (await adapters.check_health(model))["status"] == "unavailable"


async def test_openai_health_and_empty_base_path(model, install_transport):
    model.update(provider="openai", base_url="http://localhost:8001")

    def handler(request):
        assert request.url.path == "/v1/models"
        return httpx.Response(200, json={"data": [{"id": "test-model"}]})

    install_transport(handler)
    assert (await adapters.check_health(model))["status"] == "healthy"


async def test_demo_extraction_is_deterministic_and_explicit(output):
    model = {"provider": "demo", "fault_mode": "none"}
    text = (
        "设备编号：EQ-001；设备：贴标机；产线：3号产线；报告日期：2026年9月12日；故障码：E17；"
        "类别：电气；现象：传感器信号间歇丢失；处理措施：复位后恢复；停机时长：18分钟"
    )
    first = await adapters.infer(model, text)
    second = await adapters.infer(model, text)
    assert first["output"] == output
    assert first["output"] == second["output"]
    assert first["is_simulated"] is True and first["provider"] == "demo"
    assert first["input_tokens"] is None and first["output_tokens"] is None


async def test_demo_missing_fields_zero_downtime_and_no_invented_year():
    result = await adapters.infer({"provider": "demo"}, "9月12日，设备：贴标机；无故障码；未停机")
    assert result["output"]["reported_at"] == "9月12日"
    assert result["output"]["fault_code"] is None
    assert result["output"]["equipment_id"] is None
    assert result["output"]["downtime_minutes"] == 0
    missing = await adapters.infer({"provider": "demo"}, "设备编号：未记录；停机时长：未知")
    assert missing["output"]["equipment_id"] is None
    assert missing["output"]["downtime_minutes"] is None


@pytest.mark.parametrize(
    "mode,code", [("timeout", "timeout"), ("error", "upstream_error"), ("invalid_json", "invalid_output")]
)
async def test_demo_faults(mode, code):
    with pytest.raises(adapters.AdapterError) as exc:
        await adapters.infer({"provider": "demo", "fault_mode": mode}, "ticket")
    assert exc.value.code == code
    assert "演示" in exc.value.message


async def test_noisy_is_reproducible():
    model = {"provider": "demo", "fault_mode": "noisy"}
    a = await adapters.infer(model, "设备编号：EQ-001；停机时长：18分钟；故障码：E17")
    b = await adapters.infer(model, "设备编号：EQ-001；停机时长：18分钟；故障码：E17")
    assert a["output"] == b["output"]
    assert any(a["output"][field] is None for field in ("fault_code", "equipment_id", "downtime_minutes"))


@pytest.mark.parametrize(
    "text,minutes",
    [
        ("巡检用了30分钟，未说明停机时长。", None),
        ("停机时长：未记录；处理措施：维修30分钟", None),
        ("设备停机1小时20分钟，随后恢复。", 80),
        ("停机时长：1.5小时", 90),
        ("停机时长：-18分钟", None),
    ],
)
async def test_demo_downtime_requires_explicit_evidence(text, minutes):
    actual = await adapters.infer({"provider": "demo"}, text)
    assert actual["output"]["downtime_minutes"] == minutes
