# 工程记录：从有效 JSON 到符合工单规范的输出

本记录来自 v0.1 开发中的实际接口测试，使用本仓库的合成工单。目的在于说明问题如何发现、如何修复以及修复的边界，不将小样本检查作为模型选型结论。

## 1. 环境与预期行为

2026-09-23 的本地验证环境：

| 项目 | 实际配置 |
| --- | --- |
| 推理服务 | Ollama 0.34.3，监听 `127.0.0.1:11434`，关闭云推理 |
| 模型 | `qwen2.5:0.5b`，494.03M 参数，GGUF / Q4_K_M |
| 模型摘要 | `a8b0c51577010a279d933d14c2a8ab4b268079d44c5c8830c0a93900f1827c67` |
| 硬件 | Apple M4，16 GiB 内存 |
| 系统 | macOS 15.6.1，arm64，Python 3.12.14 |
| 生成参数 | `temperature=0`，`max_tokens=1024`，非流式，每次一个请求 |
| 提示词版本 | `manufacturing-extraction-v1.0` |

任务要求输出一个包含全部 9 个字段的 JSON 对象，其中分类只有 4 个合法值，其他字段可以为 `null`，停机分钟数必须是非负整数或 `null`。缺失、额外字段以及错误类型都应被拒绝。接口成功与字段内容正确分别衡量。

## 2. 原始现象

最初 OpenAI-compatible 适配器发送 `response_format={"type":"json_object"}`，同时在系统提示词中描述工单结构。该格式要求 JSON，但不等于约束全部业务字段。Ollama 原生适配器则已通过 `format` 传递完整 JSON Schema。

选取测试集每个类别的第一条记录：`SYN-0013`、`SYN-0053`、`SYN-0093`、`SYN-0133`。两个协议指向同一个本地模型，而非两个独立模型。

| 当时的路径 | 调用数 | 符合工单规范 | 实际失败情况 |
| --- | ---: | ---: | --- |
| Ollama 原生接口 + 完整 Schema | 4 | 4 | 无 |
| OpenAI-compatible + `json_object` | 4 | 0 | 3 次 HTTP 500，1 次 HTTP 成功但输出未通过字段校验 |

平台分别返回 `upstream_error` 和 `invalid_output`，没有将错误输出算作成功，也没有自动重试。错误消息只保留状态与处理建议，不透传上游响应正文。

这组结果足以说明该测试组合在当前配置下不稳定。HTTP 500 的 Ollama 内部原因未做源码级归因，因此不能据此声称所有服务的 `json_object` 都会导致相同错误。

## 3. 修复

OpenAI-compatible 请求改为标准的严格 JSON Schema 输出格式：

```json
{
  "response_format": {
    "type": "json_schema",
    "json_schema": {
      "name": "manufacturing_ticket",
      "strict": true,
      "schema": "此处实际发送完整的工单 JSON Schema 对象"
    }
  }
}
```

上例的 `schema` 字符串只是文档占位说明；真实代码发送对象，包含全部必填字段、类型、分类枚举以及 `additionalProperties: false`。完整实现见 [adapters.py](../backend/modelops/adapters.py)。

修复保留了两层约束：

1. 生成时请求服务端按照 Schema 输出，减少仅靠提示词约束产生的格式偏差。
2. 收到响应后仍在平台本地校验全部字段、类型、合法分类及字符串长度。服务端声明支持结构化输出不替代平台校验。

没有添加静默格式回退或自动重试。OpenAI-compatible 后端现在必须支持 Chat Completions 的 `response_format.type=json_schema`；不支持时明确返回上游错误，由使用者调整服务配置。

## 4. 复现方法与回归测试

按 README 启动本地 Ollama、下载 `qwen2.5:0.5b` 并安装项目依赖后，可以从同一批合成数据比较两个请求格式。以下诊断脚本直接调用本地兼容接口，避免改变平台已修复的实现：

```bash
PYTHONPATH=backend python - <<'PY'
import json
from pathlib import Path
import httpx
from modelops.adapters import SYSTEM_PROMPT, _Output

rows = json.loads(Path("data/manufacturing_tickets.json").read_text())["rows"]
selected = [r for r in rows if r["id"] in {"SYN-0013", "SYN-0053", "SYN-0093", "SYN-0133"}]
formats = {
    "json_object": {"type": "json_object"},
    "json_schema": {
        "type": "json_schema",
        "json_schema": {"name": "manufacturing_ticket", "strict": True, "schema": _Output.model_json_schema()},
    },
}
with httpx.Client(timeout=120, trust_env=False, follow_redirects=False) as client:
    for label, response_format in formats.items():
        for row in selected:
            response = client.post("http://127.0.0.1:11434/v1/chat/completions", json={
                "model": "qwen2.5:0.5b",
                "messages": [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": row["text"]}],
                "stream": False, "temperature": 0, "max_tokens": 1024,
                "response_format": response_format,
            })
            valid = False
            if response.is_success:
                try:
                    _Output.model_validate_json(response.json()["choices"][0]["message"]["content"])
                    valid = True
                except (KeyError, IndexError, TypeError, ValueError):
                    pass
            print(label, row["id"], response.status_code, "valid" if valid else "invalid")
PY
```

版本、模型缓存或服务端实现变化可能产生不同结果；该脚本提供复现路径，不保证重现相同错误数量。

自动化回归位于 [test_adapters.py](../tests/test_adapters.py)：检查兼容接口实际提交完整 Schema 和 `strict=true`，验证缺失字段、错误类型、负停机时长、未知类别以及额外字段被拒绝，并覆盖超时、连接错误、重定向与超大响应。这些测试使用 HTTPX MockTransport，不要求 GPU，也不冒充真实模型测试。

## 5. 真实复测结果与边界

修复后，两个协议各处理相同的 4 条记录，**8 次调用全部通过工单输出校验**。模型此时已加载，部分样本已用于协议诊断，所以这只是接口冒烟验证，不是独立质量评测或冷启动性能测试。

随后，通过完整平台又进行了两个协议各 16 条、共 **32 次真实调用**，全部产生合格结构。完整记录见 [Markdown 报告](examples/real-integration-report.md)、[JSON 原始结果](examples/real-integration-report.json) 和 [CSV 结果](examples/real-integration-report.csv)。

但 32 次调用的字段准确率仅为 **89.06%**，分类准确率为 **56.25%**。这说明修复解决的是输出约束与接口稳定性；有效结构并不保证模型理解正确、字段没有漏提或分类正确。真实业务仍需要有代表性的标注数据、更合适的模型及独立验收。

参考协议：[Ollama Structured Outputs](https://docs.ollama.com/capabilities/structured-outputs)、[OpenAI-compatible 接口说明](https://docs.ollama.com/api/openai-compatibility)。
