# Contributing

感谢你帮助改进 ModelOps Lab。欢迎中文或英文 Issue / Pull Request。

## 开始之前

先按 [README](README.md) 在本地启动，阅读 [架构](docs/ARCHITECTURE.md) 和 [评测方法](docs/EVALUATION.md)。较大的功能变更请先开 Issue 说明使用场景和范围；小型修复可以直接提交 PR。

建议每个 PR 只解决一个明确问题。说明触发条件、修改后行为、验证方式和已知限制，不提交依赖目录、构建产物、本地数据库或运行日志。

## 开发检查

```bash
python -m pytest -q
python scripts/generate_dataset.py
git diff --exit-code -- data/manufacturing_tickets.json
```

```bash
cd frontend
pnpm install --frozen-lockfile
pnpm build
```

CI 运行不需要 GPU、外部模型服务或秘密凭据。新增网络适配器测试应使用受控模拟响应。涉及数据、评分、任务状态和安全边界的改动请增加能够说明行为的测试；文档或样式修订不要求机械增加测试。

## 约定

- 后端使用 Python 3.11+，保持公开 API 的错误结构和字段类型一致。
- 前端使用 TypeScript；所有异步操作需要加载、失败和空数据状态。
- 修改运行依赖时更新对应锁文件，避免只修改清单而遗漏锁定版本。
- 新适配器应统一校验输出、处理超时和清理上游错误，不记录密钥或工单正文。
- 新指标需要写清分母、空值、失败请求及取消实验的计算规则。
- 合成数据修订须更新生成器、数据卡和 revision；不要把模板结果描述成真实生产成绩。
- 未经授权的企业资料、真实人员信息、模型权重和内部地址不得进入示例与测试。

## Issue 报告

请提供复现步骤、预期与实际行为、系统/运行版本、是否使用 Docker，以及脱敏后的请求编号或错误类型。真实模型相关问题请提供服务类型与接口兼容性信息。不要上传访问密钥、完整数据库或包含隐私的工单。

漏洞报告按 [SECURITY.md](SECURITY.md)处理。提交贡献表示同意按项目 [MIT License](LICENSE) 发布该贡献。
