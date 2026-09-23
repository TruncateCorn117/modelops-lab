"""Reproducible, deliberately simple metrics for structured ticket extraction.

All denominators include completed failed requests. Macro-F1 uses four fixed
classes; absent classes contribute zero. Timing is observed client wall time.
"""

from __future__ import annotations

import json
import math
import platform
import re
import unicodedata
from collections import Counter
from datetime import datetime

from modelops.adapters import CATEGORIES, OUTPUT_FIELDS, PROMPT_VERSION

EXTRACTION_FIELDS = [field for field in OUTPUT_FIELDS if field != "category"]
ERROR_LABEL = "__error__"


def _normalize(value: object) -> object:
    if isinstance(value, str):
        return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", value)).strip().casefold()
    return value


def score_output(expected: dict, actual: dict | None) -> dict:
    """Case/whitespace-normalized exact matches, including explicit null values.

    A missing output (or missing key) does not earn credit for a null reference.
    Numeric strings are not equivalent to numbers; booleans are not integers.
    """

    def matches(field: str) -> bool:
        if actual is None or field not in actual or field not in expected:
            return False
        left, right = expected[field], actual[field]
        if type(left) is not type(right):
            return False
        return _normalize(left) == _normalize(right)

    field_matches = {field: matches(field) for field in EXTRACTION_FIELDS}
    correct = sum(field_matches.values())
    return {
        "field_accuracy": correct / len(EXTRACTION_FIELDS),
        "fields_correct": correct,
        "fields_total": len(EXTRACTION_FIELDS),
        "category_correct": matches("category"),
        "field_matches": field_matches,
    }


def _quantile(values: list[float], percentile: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    position = (len(ordered) - 1) * percentile
    low, high = math.floor(position), math.ceil(position)
    result = ordered[low] + (ordered[high] - ordered[low]) * (position - low)
    return round(result, 3)


def summarize_results(results: list[dict], elapsed_seconds: float) -> dict:
    total = len(results)
    successful = 0
    fields_correct = categories_correct = 0
    latencies: list[float] = []
    errors: Counter = Counter()
    confusion = {label: {prediction: 0 for prediction in (*CATEGORIES, ERROR_LABEL)} for label in CATEGORIES}
    for result in results:
        actual = result.get("output") if result.get("status") == "success" else None
        valid = isinstance(actual, dict) and actual.get("category") in CATEGORIES
        if valid:
            successful += 1
            latency = result.get("latency_ms")
            if (
                isinstance(latency, (int, float))
                and not isinstance(latency, bool)
                and math.isfinite(latency)
                and latency >= 0
            ):
                latencies.append(float(latency))
        else:
            actual = None
            errors[result.get("error_code") or "unknown"] += 1
        expected = result.get("expected") or {}
        score = score_output(expected, actual)
        fields_correct += score["fields_correct"]
        categories_correct += score["category_correct"]
        reference = expected.get("category")
        if reference in confusion:
            confusion[reference][actual["category"] if actual else ERROR_LABEL] += 1
    f1 = []
    for label in CATEGORIES:
        true_positive = confusion[label][label]
        false_positive = sum(confusion[other][label] for other in CATEGORIES if other != label)
        false_negative = sum(count for predicted, count in confusion[label].items() if predicted != label)
        denominator = 2 * true_positive + false_positive + false_negative
        f1.append(2 * true_positive / denominator if denominator else 0.0)
    rate = successful / total if total else 0.0
    return {
        "total": total,
        "successful": successful,
        "failed": total - successful,
        "success_rate": rate,
        "valid_output_rate": rate,
        "field_accuracy": fields_correct / (total * len(EXTRACTION_FIELDS)) if total else 0.0,
        "category_accuracy": categories_correct / total if total else 0.0,
        "macro_f1": sum(f1) / len(CATEGORIES),
        "p50_latency_ms": _quantile(latencies, 0.50),
        "p95_latency_ms": _quantile(latencies, 0.95),
        "throughput_rps": total / elapsed_seconds
        if elapsed_seconds > 0 and math.isfinite(elapsed_seconds)
        else 0.0,
        "errors": dict(errors),
        "confusion_matrix": confusion,
    }


def _cell(value: object) -> str:
    """Treat all user-configurable names as text, including markdown and HTML."""
    return (
        str(value if value is not None else "—")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("|", "\\|")
        .replace("`", "\\`")
        .replace("\r", " ")
        .replace("\n", " ")
    )


def _percent(value: object) -> str:
    return f"{float(value or 0) * 100:.2f}%"


def _number(value: object) -> str:
    return f"{float(value):.3f}" if value is not None else "—"


def _elapsed(run: dict) -> float:
    try:
        start = datetime.fromisoformat(run["started_at"])
        end = datetime.fromisoformat(run["finished_at"])
        return max(0, (end - start).total_seconds())
    except (KeyError, TypeError, ValueError, AttributeError):
        return 0.0


def report_markdown(run: dict, results: list[dict]) -> str:
    """A self-describing report, not a claim of industrial or LLM suitability."""
    summary = run.get("summary") or summarize_results(results, _elapsed(run))
    snapshots = run.get("model_snapshots") or []
    if isinstance(snapshots, dict):
        snapshots = list(snapshots.values())
    snapshots = [item for item in snapshots if isinstance(item, dict)]
    lines = [
        f"# ModelOps Lab 评测报告：{_cell(run.get('name', run.get('id', '')))}",
        "",
        "> 本报告是工单提取与分类的离线评测。规则模拟服务的质量与耗时不能代表真实大模型。",
        "",
        "## 运行信息",
        "",
        "| 项目 | 值 |",
        "| --- | --- |",
        f"| 运行 ID | {_cell(run.get('id'))} |",
        f"| 状态 | {_cell(run.get('status'))} |",
        f"| 数据集 | {_cell(run.get('dataset_name'))} |",
        f"| 数据集 SHA-256 | {_cell(run.get('dataset_sha256'))} |",
        f"| 数据划分 | {_cell(run.get('split'))} |",
        f"| 样本上限（每模型） | {_cell(run.get('max_samples'))} |",
        f"| 并发数（每模型） | {_cell(run.get('concurrency'))} |",
        f"| 提示词版本 | {_cell(run.get('prompt_version', PROMPT_VERSION))} |",
        f"| 创建时间 | {_cell(run.get('created_at'))} |",
        f"| 开始时间 | {_cell(run.get('started_at'))} |",
        f"| 结束时间 | {_cell(run.get('finished_at'))} |",
        f"| 计划调用数 / 已记录结果 | {_cell(run.get('total'))} / {len(results)} |",
        "",
        "## 指标",
        "",
        "| 指标 | 所有已完成请求 |",
        "| --- | ---: |",
        f"| 完成 / 成功 / 失败 | {summary['total']} / {summary['successful']} / {summary['failed']} |",
        f"| 请求成功率 / 有效输出率 | {_percent(summary['success_rate'])} / {_percent(summary['valid_output_rate'])} |",
        f"| 字段准确率（8 字段，含空值） | {_percent(summary['field_accuracy'])} |",
        f"| 分类准确率 | {_percent(summary['category_accuracy'])} |",
        f"| 宏平均 F1（固定 4 类） | {_number(summary['macro_f1'])} |",
        f"| P50 / P95 成功请求延迟（ms） | {_number(summary['p50_latency_ms'])} / {_number(summary['p95_latency_ms'])} |",
        f"| 完成请求吞吐（requests/s，含失败） | {_number(summary['throughput_rps'])} |",
        "",
        "若同时评测规则模拟与真实模型，整体指标仅用于运行核对；请使用下表逐模型比较。",
        "服务重启后恢复的中断任务没有完整墙钟计时，吞吐标为不可用；已记录的逐请求延迟仍保留。",
        "",
        "### 各模型结果",
        "",
        "| 模型 | 类型 | 成功/完成 | 字段准确率 | 分类准确率 | Macro-F1 | P95 ms | requests/s |",
        "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    per_model = run.get("by_model") or []
    if not per_model:
        for model_id in dict.fromkeys(result.get("model_id") for result in results):
            model_results = [item for item in results if item.get("model_id") == model_id]
            snapshot = next((item for item in snapshots if item.get("id") == model_id), {})
            elapsed = (run.get("model_elapsed_seconds") or {}).get(model_id, 0.0)
            per_model.append(
                {
                    "model_id": model_id,
                    "model_name": snapshot.get("name", model_id),
                    "is_simulated": snapshot.get("provider") == "demo",
                    **summarize_results(model_results, elapsed),
                }
            )
    for item in per_model:
        lines.append(
            f"| {_cell(item.get('model_name', item.get('model_id')))} "
            f"| {'规则模拟' if item.get('is_simulated') else '真实接口'} "
            f"| {item['successful']}/{item['total']} | {_percent(item['field_accuracy'])} "
            f"| {_percent(item['category_accuracy'])} | {_number(item['macro_f1'])} "
            f"| {_number(item['p95_latency_ms'])} | {_number(item['throughput_rps'])} |"
        )
    if not per_model:
        lines.append("| — | — | 0/0 | — | — | — | — | — |")
    lines.extend(
        [
            "",
            "## 分类混淆矩阵",
            "",
            "行是真实类别，列是预测类别；失败列代表未得到有效输出。",
            "",
            "| 真实 / 预测 | mechanical | electrical | software | other | 失败 |",
            "| --- | ---: | ---: | ---: | ---: | ---: |",
        ]
    )
    for label in CATEGORIES:
        row = summary["confusion_matrix"].get(label, {})
        lines.append(
            f"| {label} | " + " | ".join(str(row.get(key, 0)) for key in (*CATEGORIES, ERROR_LABEL)) + " |"
        )
    lines.extend(["", "## 错误分布", ""])
    if summary["errors"]:
        lines.extend(f"- {_cell(code)}：{count}" for code, count in sorted(summary["errors"].items()))
    else:
        lines.append("没有已记录的失败请求。")
    lines.extend(["", "## 模型配置快照", "", "密钥值不会保存；api_key_env 仅指向运行环境中的变量名称。", ""])
    snapshot_keys = (
        "id",
        "name",
        "version",
        "provider",
        "model_name",
        "base_url",
        "api_key_env",
        "temperature",
        "max_tokens",
        "timeout_seconds",
        "fault_mode",
    )
    for snapshot in snapshots:
        lines.extend(
            [
                f"### {_cell(snapshot.get('name', snapshot.get('id')))}",
                "",
                "```json",
                json.dumps(
                    {key: snapshot.get(key) for key in snapshot_keys}, ensure_ascii=False, indent=2
                ).replace("`", "\\u0060"),
                "```",
                "",
            ]
        )
    lines.extend(
        [
            "## 计算口径与复现限制",
            "",
            "- 字段准确率为 8 个提取字段的标准化精确匹配：Unicode NFKC、大小写不敏感、连续空白合并；不做语义相似度评判。",
            "- 分类单独计分。所有失败请求的 8 个字段与分类均为 0 分；仅明确输出 null 才能匹配空值标准答案。",
            "- 空值字段纳入准确率，空值较多可能提高分数；请结合逐条结果查看非空字段和关键字段。",
            "- 成功意味着通过完整 JSON 模式校验；因此本版请求成功率等于有效输出率。错误不自动重试。",
            "- Macro-F1 固定对 mechanical、electrical、software、other 取平均，缺席类别 F1 为 0；失败计入真实类别的漏判。",
            "- P50/P95 仅统计成功请求，以客户端发起到完成校验的耗时计算，采用线性插值；不含任务排队时间。",
            "- 吞吐 = 已完成请求数（含失败）/ 对应运行墙钟时间；逐模型运行可有不同耗时，不以单请求延迟倒数推算。",
            "- 同次评测的模型依次执行，每个模型内部按配置并发。取消/中断报告仅统计已有结果，不能当作完整验收。",
            "- 提示词版本、数据哈希和模型配置已冻结；结果列表保留原文、标准答案、输出及错误，可从 JSON/CSV 导出核查。",
            "- 真实模型权重、量化版本、服务端运行时、硬件、负载、种子与缓存/预热情况需由运行者另行记录；本版不自动测量 GPU 或服务端资源。",
            "- 本版没有自动预热；首次调用可能包含模型加载时间。温度为 0 也不能保证不同后端逐字复现。",
            "- 演示服务是确定性规则解析器；noisy 模式按文本哈希注入错误，timeout 等故障为模拟行为，不能用于真实推理性能结论。",
            "- 合成数据只验证指定场景的工程流程，不足以证明真实工厂泛化、安全性或上线适用性。",
            "",
            f"报告生成环境：Python {_cell(platform.python_version())}；{_cell(platform.system())} {_cell(platform.machine())}。",
        ]
    )
    return "\n".join(lines) + "\n"
