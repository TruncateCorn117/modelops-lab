# 部署与真实模型接入

## 运行配置

所有配置通过后端进程环境变量提供。直接启动 Python 时不会自动读取 `.env` 文件；Docker Compose 会读取项目目录的 `.env` 供变量替换。不要提交包含密钥的文件。

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `MODEL_OPS_DB` | `runtime/modelops.db` | SQLite 文件路径 |
| `MODEL_OPS_DATA` | 仓库 `data/` | 首次初始化读取合成数据的目录 |
| `MODEL_OPS_API_KEY` | 空 | 平台访问密钥；非空时 API 与 `/metrics` 需要 Bearer 鉴权 |
| `MODEL_OPS_ALLOWED_HOSTS` | `localhost,127.0.0.1,::1,host.docker.internal` | 允许访问的上游主机名，逗号分隔；设置后替换默认列表 |
| `MODEL_PROVIDER_API_KEY` | 空 | Compose 预留的上游密钥变量；在模型配置中填写这个变量名 |

`MODEL_OPS_API_KEY` 是访问本平台的密钥，`MODEL_PROVIDER_API_KEY` 是平台调用模型服务的密钥，两者独立。通过 API/UI 保存的是上游变量名 `api_key_env`，不保存实际密钥。变量新增或变更后重启后端/重建容器使其生效。

本地启动示例：

```bash
export MODEL_OPS_API_KEY='replace-with-a-long-random-access-key'
export MODEL_OPS_ALLOWED_HOSTS='localhost,127.0.0.1,::1,host.docker.internal,inference.example.org'
uvicorn modelops.main:app --host 127.0.0.1 --port 8000 --workers 1
```

在工作台访问密钥设置中输入平台密钥；浏览器仅在当前标签页会话中保存。API 调用加 `Authorization: Bearer ...`。`/api/health` 保持公开，用于存活检查；静态页面和接口描述不是受保护的数据接口。

第一版只支持一个后端进程/worker。不要通过增加 Uvicorn worker 扩容；进程内评测状态与并发限制不跨进程同步。

## Ollama

按 [Ollama 官方安装说明](https://docs.ollama.com/quickstart)安装并启动服务。根据本机内存及模型许可证选择模型，下载完成后用 `ollama list` 确认准确名称。平台不会帮你拉取模型权重。

1. 在「模型中心」新建服务，provider 选择 `ollama`。
2. 服务地址填写 `http://127.0.0.1:11434`，模型名称填实际安装的名称。
3. 给服务设置自己可追踪的版本，如权重标签和量化版本，超时可先设为 120 秒。
4. 点击健康检查，然后在工单体验台做一次真实调用。
5. 确认输出与延迟后，用相同 test 样本创建评测。

适配器调用 [Ollama `/api/chat`](https://docs.ollama.com/api/chat)，关闭流式响应，并提供结构化输出格式。输入与输出 token 数取自服务返回值，服务未提供时保留空值。

**Docker 内访问宿主机：** 地址改为 `http://host.docker.internal:11434`。Compose 已为 Linux 添加 `host-gateway` 映射。模型服务还需监听容器可达的宿主机接口；如果它只绑定宿主机 loopback，部分环境下容器仍无法访问。仅在可信网络接口开放模型端口，并用防火墙限制来源。

## OpenAI 兼容服务

第一版调用 Chat Completions 风格的非流式文本接口，并发送 `response_format: {"type": "json_schema", ...}` 和 `strict: true` 的完整字段模式。上游必须支持 JSON Schema 结构化输出；仅接受普通聊天或 `json_object` 的服务不能保证兼容。服务地址填写 API 根路径，例如 `http://127.0.0.1:8001/v1`；不要填写完整的 `/chat/completions` 路径。没有路径的基础地址会补 `/v1`，有路径时按填写路径使用。

登记示例：

```json
{
  "name": "本地工单模型",
  "version": "weights-v1-q4",
  "provider": "openai",
  "model_name": "your-served-model-id",
  "base_url": "http://127.0.0.1:8001/v1",
  "api_key_env": "MODEL_PROVIDER_API_KEY",
  "timeout_seconds": 120,
  "temperature": 0,
  "max_tokens": 1024,
  "fault_mode": "none",
  "enabled": true
}
```

如果本地服务没有鉴权，`api_key_env` 留空。需要鉴权时，在启动后端的同一终端设置变量，或在 Compose 使用的 `.env` 中设置 `MODEL_PROVIDER_API_KEY`。使用自定义变量名时，需要在 Compose 中额外显式传入该变量。

远端服务还需将确切主机名加入白名单，例如 `inference.example.org`，不含协议、路径或通配符。适配器不跟随重定向，也不自动使用系统代理环境变量。主机白名单是管理员配置边界，不是完整的网络隔离系统；共享或公网环境应增加网络出口规则。

“OpenAI 兼容”只表示实现了本项目使用的接口子集，不保证所有服务的 JSON 格式选项、token 统计和错误码相同。平台不自动回退到宽松输出格式，不自动重试。健康检查读取模型列表；如果服务不提供列表接口，健康状态可能失败，即使聊天端点可用。请记录实际兼容性。

## 持久化与备份

本地运行保存到 `runtime/modelops.db`。Compose 保存到命名卷 `modelops-data`。数据包含模型配置、用户导入的数据集、实验快照、工单原文、标准答案、解析结果和请求日志；上游原始响应文本不额外持久化。

没有自动保留期限或删除策略。定期评测会使数据库增长。备份前停止后端，再复制数据库及可能存在的 SQLite WAL/SHM 文件；或者使用 SQLite 的备份功能创建一致快照。不要只在写入过程中随意复制主数据库文件。

仅对可丢弃的本地演示环境，停止服务并移走 `runtime/` 后可重新初始化。本地演示容器可通过 `docker compose down -v` 重置，**这会删除卷内所有历史与导入数据**。需要保留记录时先导出/备份，使用普通 `docker compose down` 即可。

修改仓库中的种子 JSON 不会覆盖现有数据库数据。要评估修订数据，请通过导入创建新的数据集并更新 revision。

## 常见问题

| 现象 | 检查方式 |
| --- | --- |
| 页面打不开，但 `/api/health` 正常 | 确认已在 `frontend/` 执行 `pnpm build`，再重启后端 |
| 返回 401 | 平台启用了访问密钥；检查工作台设置或 Bearer 请求头 |
| 返回 `configuration_error` | 检查上游主机白名单、URL 格式以及密钥变量名 |
| 返回 `connection_error` | 检查服务进程、监听端口、容器访问宿主机地址 |
| 第一次调用超时 | 检查模型加载耗时；合理增大超时或先预热并记录 |
| 返回 `invalid_output` | 查看请求上下文与服务日志，确认支持 JSON 输出且字段完整 |
| 模型不能修改/删除 | 它正在参与实验；等待完成或取消实验 |
| API 返回 429 | 已达全局调用上限或实验数上限；等待已有请求完成 |
| 重启后实验为 interrupted | 任务在进程内运行；已有结果保留，需要新建实验重测 |
| CPU 图不是模型资源 | 面板只采 API 进程，需要另行接入模型服务器/GPU 监控 |

## 对外部署边界

默认 Compose 仅绑定本机。向团队开放时，应由部署方配置 HTTPS 反向代理、访问控制、可信上游及数据保留政策。内置单一访问密钥不区分用户权限，也没有多租户隔离、密码恢复或审计合规功能。参见 [SECURITY.md](../SECURITY.md)。
