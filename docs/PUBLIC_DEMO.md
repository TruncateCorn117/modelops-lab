# 将公开演示挂到现有网站

本项目提供可选的公开演示模式，适合在个人作品集中展示。完整模式仍用于本地或可信团队。

## 公开演示的行为

- 访客可浏览内置模型、160 条合成工单、预生成评测及报告。
- 工单体验台只调用规则演示服务；提交的文本和返回结果不写入数据库。
- 模型修改、数据导入、新建/取消评测等写操作被服务端拒绝，输入 API 密钥也不会解锁。
- 独立数据库在启动时检查公开数据范围，拒绝包含真实模型或私有调用记录的数据库。
- API 进程仍记录请求编号、状态和耗时等运行信息，日志不包含工单文本和输出。反向代理保留常规访问日志。
- 公开页面上的规则结果不代表大模型质量。真实模型验证报告另见 [验证记录](VALIDATION.md)。

公开部署使用专用数据卷、只读容器文件系统及无外网访问的容器网络。Nginx 示例额外限制请求速率、并发连接与请求大小。不要把本地历史数据库复制到公开部署。

## 在 `/modelops/` 子目录部署

需要 Linux 服务器、已有 HTTPS 网站、宿主机 Nginx、Docker 和 Compose。先确认 `172.30.80.0/28` 未与现有网络冲突。在仓库根目录执行：

```bash
docker compose -f deploy/compose.public.yml build
docker compose -f deploy/compose.public.yml run --rm modelops python scripts/seed_public_demo.py
docker compose -f deploy/compose.public.yml up -d
```

预置脚本会离线运行 test 集的 64 条合成工单和两种规则服务，共 128 次模拟调用。再次运行时保留已有报告；重新执行 `compose run` 前先停止演示服务，避免固定容器地址冲突。它不开放公开创建实验的 API。

容器不发布宿主机端口。Linux 宿主机 Nginx 通过隔离桥接网络中的固定地址 `172.30.80.2:8000` 访问应用。将 [请求限制配置](../deploy/nginx-rate-limit.conf) 放入 Nginx 的 `http` 上下文，将 [路径配置](../deploy/nginx-location.conf) 包含到现有 HTTPS `server` 块中。先备份配置，再执行 `nginx -t`，检查通过后平滑重载。

若网站在 CDN 后方，沿用现有经过验证的真实客户端 IP 配置；不要信任来自任意来源的转发头。容器只信任来自桥接网关 `172.30.80.1` 的转发头。若修改网段，同步修改 Compose、Nginx 目标地址和受信代理地址。该宿主机直连内部桥接地址的示例适用于 Linux，Docker Desktop 的网络模型不同。

```bash
curl https://your-domain.example/modelops/api/health
```

返回值应包含 `public_demo: true`。打开 `https://your-domain.example/modelops/`，确认工单体验、报告下载及模型修改限制均正常。接口文档位于 `/modelops/docs`。

## 路径配置

| 配置 | 示例 | 作用 |
| --- | --- | --- |
| `VITE_BASE_PATH` | `/modelops/` | 前端构建时设置资源、接口和文档地址前缀 |
| `MODEL_OPS_ROOT_PATH` | `/modelops` | 后端代理部署路径；反向代理保留该前缀转发，确保静态资源路径正确 |
| `MODEL_OPS_PUBLIC_DEMO` | `true` | 开启公开演示限制；默认关闭 |
| `MODEL_OPS_DB` | `/app/runtime/public-demo.db` | 专用公开数据库 |

Nginx 的 `proxy_pass` 只填写上游协议、地址和端口，不附加 URI 或尾部斜杠。移除请求中的 `/modelops/` 前缀可能仍能访问部分 API，但会使挂载的静态资源返回 404。

迁移到另一子目录时，同步修改 Compose 构建参数、后端环境变量和 Nginx 路径后重建镜像。根路径部署保留默认前端 `/` 与空后端前缀。

## 更新与回退

更新前保存当前镜像标识及数据库备份，再构建新版并运行健康检查。`docker compose ... up -d` 会保留数据卷。若新版本检查失败，使用上一镜像重建容器；不要执行 `down -v`。

公开演示不需要模型权重、上游密钥或 GPU。需要完整管理与真实模型评测时，请按[部署文档](DEPLOYMENT.md)运行独立的完整实例。
