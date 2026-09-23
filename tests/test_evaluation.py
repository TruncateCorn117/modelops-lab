import copy

import pytest
from modelops.adapters import OUTPUT_FIELDS
from modelops.evaluation import report_markdown, score_output, summarize_results


@pytest.fixture
def expected():
    return {
        **dict.fromkeys(OUTPUT_FIELDS),
        "category": "mechanical",
        "equipment_id": "EQ-01",
        "symptom": "Bearing wear",
        "downtime_minutes": 15,
    }


def result(expected, output=None, *, status="success", latency=100, error_code=None, model_id="a"):
    return {
        "expected": expected,
        "output": output if output is not None else copy.deepcopy(expected),
        "status": status,
        "latency_ms": latency,
        "error_code": error_code,
        "model_id": model_id,
    }


def test_exact_matching_with_normalization_and_nulls(expected):
    output = {**expected, "symptom": "  BEARING \t wear \n", "equipment_id": "eq-01"}
    score = score_output(expected, output)
    assert score["fields_correct"] == 8
    assert score["fields_total"] == 8
    assert score["field_accuracy"] == 1
    assert score["category_correct"] is True
    assert "category" not in score["field_matches"]


def test_failure_never_receives_null_credit(expected):
    score = score_output(expected, None)
    assert score["fields_correct"] == 0
    assert score["field_accuracy"] == 0
    assert score["category_correct"] is False
    assert not any(score["field_matches"].values())


def test_missing_field_not_equivalent_to_explicit_null(expected):
    output = {key: value for key, value in expected.items() if key != "fault_code"}
    assert score_output(expected, output)["fields_correct"] == 7


@pytest.mark.parametrize("value", ["15", True, 15.0])
def test_typed_comparison(expected, value):
    assert score_output(expected, {**expected, "downtime_minutes": value})["fields_correct"] == 7


def test_category_excluded_from_field_score(expected):
    score = score_output(expected, {**expected, "category": "electrical"})
    assert score["field_accuracy"] == 1
    assert score["category_correct"] is False


def test_fixed_four_class_macro_f1_penalizes_absent_classes(expected):
    summary = summarize_results([result(expected)], 2)
    assert summary["category_accuracy"] == 1
    assert summary["macro_f1"] == 0.25
    assert summary["throughput_rps"] == 0.5
    assert summary["p95_latency_ms"] == 100


def test_failure_denominators_confusion_and_success_only_latency(expected):
    results = [
        result(expected, latency=100),
        result(expected, status="error", latency=9999, error_code="timeout"),
    ]
    summary = summarize_results(results, 2)
    assert summary["total"] == 2 and summary["successful"] == 1 and summary["failed"] == 1
    assert summary["success_rate"] == summary["valid_output_rate"] == 0.5
    assert summary["field_accuracy"] == summary["category_accuracy"] == 0.5
    assert summary["p95_latency_ms"] == 100
    assert summary["throughput_rps"] == 1
    assert summary["macro_f1"] == pytest.approx((2 / 3) / 4)
    assert summary["confusion_matrix"]["mechanical"]["__error__"] == 1
    assert summary["errors"] == {"timeout": 1}


def test_known_confusion_matrix_macro_f1_and_linear_quantiles(expected):
    results = [
        result(expected, latency=100),
        result(expected, {**expected, "category": "electrical"}, latency=200),
        result({**expected, "category": "electrical"}, latency=300),
        result({**expected, "category": "software"}, latency=400),
        result({**expected, "category": "other"}, latency=500),
    ]
    summary = summarize_results(results, 5)
    assert summary["macro_f1"] == pytest.approx((2 / 3 + 2 / 3 + 1 + 1) / 4)
    assert summary["category_accuracy"] == 0.8
    assert summary["field_accuracy"] == 1
    assert summary["p50_latency_ms"] == 300
    assert summary["p95_latency_ms"] == 480
    assert summary["confusion_matrix"]["mechanical"]["electrical"] == 1


def test_empty_results_are_finite_and_missing_quantiles():
    summary = summarize_results([], 0)
    assert summary["total"] == 0
    assert summary["macro_f1"] == summary["field_accuracy"] == summary["throughput_rps"] == 0
    assert summary["p50_latency_ms"] is None and summary["p95_latency_ms"] is None


def test_failed_run_has_no_latency_percentiles(expected):
    summary = summarize_results([result(expected, status="error")], 1)
    assert summary["successful"] == 0
    assert summary["field_accuracy"] == summary["macro_f1"] == 0
    assert summary["p95_latency_ms"] is None
    assert summary["errors"] == {"unknown": 1}


def test_report_contains_reproduction_context_and_simulation_label(expected):
    results = [result(expected)]
    snapshot = {
        "id": "a",
        "name": "Demo | <script>",
        "provider": "demo",
        "api_key_env": "MODEL_KEY",
        "api_key": "must-not-export",
        "model_name": "parser",
        "version": "1",
        "fault_mode": "none",
    }
    run = {
        "id": "run-1",
        "name": "first",
        "status": "completed",
        "dataset_sha256": "abc123",
        "dataset_name": "synthetic",
        "split": "test",
        "prompt_version": "test-v1",
        "concurrency": 2,
        "model_snapshots": [snapshot],
        "model_elapsed_seconds": {"a": 1},
        "total": 1,
        "started_at": "2026-01-01T00:00:00+00:00",
        "finished_at": "2026-01-01T00:00:01+00:00",
    }
    original = copy.deepcopy(run)
    report = report_markdown(run, results)
    assert "abc123" in report and "test-v1" in report and "MODEL_KEY" in report
    assert "must-not-export" not in report
    assert "规则模拟" in report and "不能代表真实大模型" in report
    assert "缺席类别 F1 为 0" in report
    assert "含失败" in report and "未得到有效输出" in report
    assert "| 并发数（每模型） | 2 |" in report
    assert "Demo \\| &lt;script&gt;" in report
    assert run == original
