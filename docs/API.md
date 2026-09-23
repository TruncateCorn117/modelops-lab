# API 使用指南

运行后访问 [Swagger UI](http://localhost:8000/docs) 查看当前完整模式；[OpenAPI JSON](http://localhost:8000/openapi.json) 是字段约束的程序化来源。本页示例使用默认本地演示配置。

## 认证与错误

启用 `MODEL_OPS_API_KEY` 后，除 `/api/health` 外的 API 和 `/metrics` 都需 `Authorization: Bearer <平台密钥>`。以下示例自动使用当前终端的同名环境变量；未启用认证时该请求头可省略。

成功调用有请求编号，响应头也提供 `X-Request-ID`。错误统一返回：

```json
{
  "error": {
    "code": "timeout",
    "message": "模型服务响应超时。",
    "request_id": "req_example"
  }
}
```

常见状态：400 配置错误、401 未授权、404 不存在、409 模型忙或状态冲突、422 参数校验失败、429 容量已满、502/503 上游错误或连接失败、504 超时。具体错误代码用于程序判断，错误文案可能调整。

## 调用模型

```bash
curl -sS http://localhost:8000/api/models \
  -H "Authorization: Bearer ${MODEL_OPS_API_KEY:-}"
```

```bash
curl -sS http://localhost:8000/api/infer \
  -H "Authorization: Bearer ${MODEL_OPS_API_KEY:-}" \
  -H 'Content-Type: application/json' \
  -d '{"model_id":"demo-baseline","text":"设备：贴标机；产线：3号产线；报告日期：2025-03-12；故障码：E17；现象：光电传感器信号间歇丢失；处理措施：重新固定传感器接线端子；停机时长：18分钟"}'
```

`model_id` 设为 `null` 时使用启用的默认模型。响应包含 `output`、`latency_ms`、token 数（服务不提供时为 `null`）和 `is_simulated`。Demo 为 `true`，其耗时不能用来估计真实推理速度。

## 模型管理

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET / POST | `/api/models` | 列表 / 新增 |
| PUT / DELETE | `/api/models/{id}` | 整体更新可编辑配置 / 删除 |
| POST | `/api/models/{id}/health` | 立即健康检查 |
| POST | `/api/models/{id}/default` | 设置默认模型 |

PUT 使用与新增相同的可编辑字段模式；省略可选字段会采用模式默认值，不是局部 patch。活跃实验中的模型禁止修改/删除。登记真实服务的 JSON 示例见[部署文档](DEPLOYMENT.md)。

## 数据集

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET / POST | `/api/datasets` | 列表 / 导入 |
| GET | `/api/datasets/{id}` | 包含行数据的详情 |
| GET | `/api/datasets/{id}/export` | 下载可再次导入的 JSON |

内置数据集 ID 为 `manufacturing-v1`。导入规范见[数据卡](DATA_CARD.md)，每条记录的 9 个标准答案字段都必须存在。第一版没有数据集覆盖更新接口，修订时导入为新数据集。

```bash
curl -sS http://localhost:8000/api/datasets/manufacturing-v1/export \
  -H "Authorization: Bearer ${MODEL_OPS_API_KEY:-}" \
  -o manufacturing-export.json
```

## 创建与追踪实验

```bash
curl -sS http://localhost:8000/api/runs \
  -H "Authorization: Bearer ${MODEL_OPS_API_KEY:-}" \
  -H 'Content-Type: application/json' \
  -d '{"name":"合成工单基线对比","dataset_id":"manufacturing-v1","model_ids":["demo-baseline","demo-noisy"],"concurrency":2,"max_samples":64,"split":"test"}'
```

返回 HTTP 202 和实验对象，使用返回的 `id` 查询状态。64 条 test 样本乘两个模型为 128 次计划调用。`concurrency` 为每个模型内部并发，模型本身按顺序执行。可选 `split` 为 `dev`、`test`、`all`，上限 1000 条。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/runs` | 实验列表 |
| GET | `/api/runs/{id}` | 状态、进度和汇总 |
| POST | `/api/runs/{id}/cancel` | 取消并保留已有结果 |
| GET | `/api/runs/{id}/results` | 逐条输入、标准答案、结果与字段评分 |
| GET | `/api/runs/{id}/report?format=markdown` | Markdown 报告 |
| GET | `/api/runs/{id}/report?format=json` | 实验配置与完整结果 |
| GET | `/api/runs/{id}/report?format=csv` | 表格形式的逐条评分与输出 |

`queued` / `running` 为活跃状态，`completed` / `cancelled` / `interrupted` / `failed` 为终态。报告可在未完成时导出，但仅涵盖当前已有结果。

## 观测接口

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/health` | 应用存活、版本、是否需要认证 |
| GET | `/api/dashboard` | 历史汇总、趋势、最近请求与 API 进程资源 |
| GET | `/api/requests?limit=100&status=error` | 请求日志列表，可按 model_id / status 筛选 |
| GET | `/api/requests/{id}` | 请求原文、输出和元数据 |
| GET | `/metrics` | Prometheus 格式指标 |

请求列表省略原文与输出，详情接口才能读取；两者都属于受认证保护的 API。日志保存在 SQLite，没有自动保留期限。Prometheus 指标是当前进程累计值，重启后清零；仪表盘历史从数据库读取。
