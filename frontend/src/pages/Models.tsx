import { useState } from "react";
import {
  ArrowUpRight,
  Box,
  Check,
  CircleCheck,
  FlaskConical,
  Pencil,
  Plus,
  Radio,
  Search,
  Server,
  ShieldCheck,
  Star,
  Trash2,
  Zap,
} from "lucide-react";
import { api, post, refreshData, useApi } from "../api";
import type { Model, ModelInput, Provider } from "../types";
import {
  Button,
  Card,
  CheckField,
  DemoBadge,
  Empty,
  ErrorState,
  Loading,
  Modal,
  Notice,
  PageHeader,
  StatusBadge,
  useToast,
} from "../ui";
import { date, errorMessage } from "../utils";
import { LocalDeploymentNotice, usePublicDemo } from "../publicDemo";

const providers: Record<Provider, string> = {
  demo: "规则模拟服务",
  ollama: "Ollama",
  openai: "OpenAI 兼容服务",
};
const defaultForm: ModelInput = {
  name: "",
  version: "1.0",
  provider: "ollama",
  model_name: "",
  base_url: "http://localhost:11434",
  api_key_env: "",
  timeout_seconds: 60,
  temperature: 0,
  max_tokens: 1024,
  fault_mode: "none",
  enabled: true,
};
export default function Models() {
  const publicDemo = usePublicDemo();
  const query = useApi<Model[]>("/api/models");
  const [editing, setEditing] = useState<Model | "new" | null>(null);
  const [deleting, setDeleting] = useState<Model | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [busy, setBusy] = useState<string | null>(null);
  const notify = useToast();
  const models = query.data || [];
  const filtered = models.filter(
    (model) =>
      `${model.name} ${model.model_name} ${model.version}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (filter === "all" || model.provider === filter),
  );
  async function action(model: Model, operation: "health" | "default") {
    if (publicDemo) return;
    setBusy(`${model.id}:${operation}`);
    try {
      const result = await post<Model>(
        `/api/models/${encodeURIComponent(model.id)}/${operation}`,
      );
      notify(
        operation === "default"
          ? `已将 ${model.name} 设为默认模型。`
          : result.status === "healthy"
            ? `${model.name} 健康检查通过。`
            : result.health_detail || "模型服务暂不可用。",
        operation === "health" && result.status !== "healthy",
      );
      refreshData();
    } catch (error) {
      notify(errorMessage(error), true);
    } finally {
      setBusy(null);
    }
  }
  async function remove() {
    if (!deleting || publicDemo) return;
    setBusy(`${deleting.id}:delete`);
    try {
      await api(`/api/models/${encodeURIComponent(deleting.id)}`, {
        method: "DELETE",
      });
      notify("模型配置已删除，历史请求和评测快照仍可查看。");
      setDeleting(null);
      refreshData();
    } catch (error) {
      notify(errorMessage(error), true);
    } finally {
      setBusy(null);
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="MODEL REGISTRY"
        title="模型中心"
        description="统一管理模型版本与服务连接，给每个推理实例一个清晰的身份。"
        actions={
          <Button
            variant="primary"
            icon={<Plus size={17} />}
            onClick={() => setEditing("new")}
            disabled={publicDemo}
            title={publicDemo ? "请本地部署完整版本" : undefined}
          >
            接入模型
          </Button>
        }
      />
      <LocalDeploymentNotice />
      <div className="mini-stats-grid">
        <Card className="mini-stat">
          <span className="stat-symbol">
            <Box size={20} />
          </span>
          <div>
            <span>已注册模型</span>
            <strong>{models.length}</strong>
          </div>
        </Card>
        <Card className="mini-stat">
          <span className="stat-symbol green">
            <Radio size={20} />
          </span>
          <div>
            <span>健康检查通过</span>
            <strong>
              {models.filter((model) => model.status === "healthy").length}
            </strong>
          </div>
        </Card>
        <Card className="mini-stat">
          <span className="stat-symbol violet">
            <Server size={20} />
          </span>
          <div>
            <span>真实推理服务</span>
            <strong>
              {models.filter((model) => model.provider !== "demo").length}
            </strong>
          </div>
        </Card>
      </div>
      <Notice>
        预置 Demo 使用确定性规则处理合成工单，用于验证平台流程。接入 Ollama 或
        OpenAI 兼容服务后，才能评测真实大模型的表现。
      </Notice>
      <Card>
        <div className="table-toolbar">
          <div className="segmented" aria-label="筛选服务类型">
            {[
              { id: "all", name: "全部模型" },
              { id: "demo", name: "规则模拟" },
              { id: "ollama", name: "Ollama" },
              { id: "openai", name: "OpenAI 兼容" },
            ].map((item) => (
              <button
                key={item.id}
                className={filter === item.id ? "selected" : ""}
                onClick={() => setFilter(item.id)}
              >
                {item.name}
              </button>
            ))}
          </div>
          <div className="search-input">
            <Search size={16} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="搜索模型"
              placeholder="搜索名称、版本…"
            />
          </div>
        </div>
        {query.error && <ErrorState error={query.error} retry={query.reload} />}
        {query.loading ? (
          <Loading text="正在加载模型目录…" />
        ) : !filtered.length ? (
          <Empty
            icon={<Box size={26} />}
            title={models.length ? "没有匹配的模型" : "接入你的第一个模型"}
            description={
              models.length
                ? "调整搜索词或服务类型筛选。"
                : "连接本地或远程推理服务，开始工单处理与评测。"
            }
            action={
              !models.length && (
                <Button
                  variant="primary"
                  onClick={() => setEditing("new")}
                  disabled={publicDemo}
                  icon={<Plus size={15} />}
                >
                  接入模型
                </Button>
              )
            }
          />
        ) : (
          <div className="model-list">
            {filtered.map((model) => (
              <div
                className={`model-row ${!model.enabled ? "model-disabled" : ""}`}
                key={model.id}
              >
                <div className={`model-logo provider-${model.provider}`}>
                  {model.provider === "demo" ? (
                    <FlaskConical size={25} />
                  ) : model.provider === "ollama" ? (
                    <Box size={25} />
                  ) : (
                    <Zap size={25} />
                  )}
                </div>
                <div className="model-identity">
                  <div className="model-title">
                    <h3>{model.name}</h3>
                    {model.is_default && (
                      <span className="badge badge-teal">
                        <Star size={11} />
                        默认
                      </span>
                    )}
                    {model.provider === "demo" && <DemoBadge />}
                    {!model.enabled && <StatusBadge status="disabled" />}
                  </div>
                  <div className="model-subtitle">
                    <span>{providers[model.provider]}</span>
                    <i />
                    版本 {model.version}
                    <i />
                    <code>{model.model_name}</code>
                  </div>
                  <span className="model-endpoint">
                    {model.provider === "demo"
                      ? `本地规则引擎 · 故障模式：${model.fault_mode}`
                      : model.base_url}
                  </span>
                </div>
                <div className="model-health">
                  <StatusBadge status={model.status} />
                  <small title={model.health_detail || ""}>
                    {model.last_checked
                      ? `检查于 ${date(model.last_checked, true)}`
                      : "尚未检查服务连接"}
                  </small>
                </div>
                <div className="model-actions">
                  <Button
                    icon={<Radio size={14} />}
                    onClick={() => action(model, "health")}
                    busy={busy === `${model.id}:health`}
                    disabled={publicDemo || Boolean(busy)}
                    title={publicDemo ? "请本地部署完整版本" : undefined}
                  >
                    检查
                  </Button>
                  <div className="model-icon-actions">
                    <button
                      className="icon-button"
                      title={publicDemo ? "请本地部署完整版本" : "编辑模型"}
                      aria-label={`编辑 ${model.name}`}
                      onClick={() => setEditing(model)}
                      disabled={publicDemo}
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      className={`icon-button ${model.is_default ? "is-default" : ""}`}
                      title={
                        publicDemo
                          ? "请本地部署完整版本"
                          : model.is_default
                            ? "当前默认模型"
                            : "设为默认模型"
                      }
                      aria-label={`将 ${model.name} 设为默认模型`}
                      onClick={() => action(model, "default")}
                      disabled={
                        publicDemo ||
                        model.is_default ||
                        !model.enabled ||
                        Boolean(busy)
                      }
                    >
                      <Star
                        size={16}
                        fill={model.is_default ? "currentColor" : "none"}
                      />
                    </button>
                    <button
                      className="icon-button danger-hover"
                      title={publicDemo ? "请本地部署完整版本" : "删除模型"}
                      aria-label={`删除 ${model.name}`}
                      onClick={() => setDeleting(model)}
                      disabled={publicDemo || Boolean(busy)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
                {model.status === "unavailable" && model.health_detail && (
                  <div className="model-health-detail">
                    {model.health_detail}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="table-bottom-note">
          <ShieldCheck size={14} />
          <span>上游密钥通过后端环境变量读取，模型配置仅保存变量名称。</span>
          <span>{filtered.length} 个模型</span>
        </div>
      </Card>
      <div className="next-step-note">
        <CircleCheck size={18} />
        <span>完成模型接入后，先试运行一条工单，再创建批量评测。</span>
        <a className="text-link" href="#playground">
          打开工单体验台 <ArrowUpRight size={15} />
        </a>
      </div>
      {editing && !publicDemo && (
        <ModelForm
          model={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
      {deleting && !publicDemo && (
        <Modal
          title="删除模型配置"
          description="此操作会移除模型目录中的这条配置。"
          onClose={() => {
            if (!busy) setDeleting(null);
          }}
        >
          <div className="modal-body">
            <p>
              确认删除 <strong>{deleting.name}</strong>
              ？已记录的请求和评测快照会保留。运行中的评测所使用的模型暂时无法删除。
            </p>
          </div>
          <div className="modal-footer">
            <Button onClick={() => setDeleting(null)} disabled={Boolean(busy)}>
              保留模型
            </Button>
            <Button
              variant="danger"
              busy={Boolean(busy)}
              onClick={remove}
              icon={<Trash2 size={15} />}
            >
              删除配置
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
function ModelForm({ model, onClose }: { model?: Model; onClose: () => void }) {
  const [form, setForm] = useState<ModelInput>(
    model
      ? {
          name: model.name,
          version: model.version,
          provider: model.provider,
          model_name: model.model_name,
          base_url: model.base_url,
          api_key_env: model.api_key_env,
          timeout_seconds: model.timeout_seconds,
          temperature: model.temperature,
          max_tokens: model.max_tokens,
          fault_mode: model.fault_mode,
          enabled: model.enabled,
        }
      : defaultForm,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const notify = useToast();
  function patch<K extends keyof ModelInput>(key: K, value: ModelInput[K]) {
    setForm((previous) => ({ ...previous, [key]: value }));
  }
  function changeProvider(provider: Provider) {
    setForm((previous) => ({
      ...previous,
      provider,
      base_url:
        provider === "ollama"
          ? "http://localhost:11434"
          : provider === "openai"
            ? "http://localhost:8001/v1"
            : "",
      model_name: provider === "demo" ? "rule-baseline" : "",
      fault_mode: "none",
      api_key_env: "",
    }));
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(
        `/api/models${model ? `/${encodeURIComponent(model.id)}` : ""}`,
        {
          method: model ? "PUT" : "POST",
          body: JSON.stringify({
            ...form,
            name: form.name.trim(),
            model_name: form.model_name.trim(),
            base_url: form.base_url.trim(),
            api_key_env: form.api_key_env.trim() || "",
          }),
        },
      );
      notify(
        model ? "模型配置已更新。" : "模型已接入，请执行健康检查验证连接。",
      );
      refreshData();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason : new Error(String(reason)));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={model ? "编辑模型配置" : "接入模型服务"}
      description="登记一个已有的推理服务。接入后可统一调用并参与评测。"
      onClose={() => {
        if (!busy) onClose();
      }}
      wide
    >
      <form onSubmit={submit}>
        <div className="modal-body form-stack">
          <div className="form-section-label">基础信息</div>
          <div className="form-grid">
            <label className="form-field">
              <span>
                显示名称 <b>*</b>
              </span>
              <input
                required
                maxLength={100}
                placeholder="例如：Qwen 2.5 · 工单提取"
                value={form.name}
                onChange={(event) => patch("name", event.target.value)}
              />
            </label>
            <label className="form-field">
              <span>
                模型版本 <b>*</b>
              </span>
              <input
                required
                maxLength={80}
                value={form.version}
                onChange={(event) => patch("version", event.target.value)}
                placeholder="例如：7b-q4 / 1.0"
              />
            </label>
          </div>
          <div className="form-grid">
            <label className="form-field">
              <span>推理服务类型</span>
              <select
                value={form.provider}
                onChange={(event) =>
                  changeProvider(event.target.value as Provider)
                }
              >
                {Object.entries(providers).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-field">
              <span>
                服务中的模型名称 <b>*</b>
              </span>
              <input
                required
                maxLength={200}
                value={form.model_name}
                onChange={(event) => patch("model_name", event.target.value)}
                placeholder={
                  form.provider === "ollama"
                    ? "例如：qwen2.5:3b"
                    : form.provider === "demo"
                      ? "rule-baseline"
                      : "例如：Qwen/Qwen2.5-7B-Instruct"
                }
              />
              <small>须与推理服务实际提供的模型标识一致。</small>
            </label>
          </div>
          {form.provider !== "demo" && (
            <>
              <label className="form-field">
                <span>
                  服务基础地址 <b>*</b>
                </span>
                <input
                  type="url"
                  required
                  value={form.base_url}
                  onChange={(event) => patch("base_url", event.target.value)}
                  placeholder="http://localhost:11434"
                />
                <small>
                  OpenAI 兼容服务通常以 /v1 结尾。远程域名需在后端
                  MODEL_OPS_ALLOWED_HOSTS 中显式允许。
                </small>
              </label>
              <label className="form-field">
                <span>
                  上游密钥环境变量名 <span className="optional">选填</span>
                </span>
                <input
                  value={form.api_key_env || ""}
                  onChange={(event) =>
                    patch("api_key_env", event.target.value || "")
                  }
                  placeholder="例如：UPSTREAM_API_KEY（请勿填入密钥本身）"
                  pattern="[A-Z][A-Z0-9_]{0,99}"
                  autoComplete="off"
                />
                <small>在后端运行环境设置该变量，平台仅保存变量名。</small>
              </label>
            </>
          )}
          {form.provider === "demo" && (
            <>
              <Notice tone="warning">
                规则模拟服务不调用真实
                LLM。仅用于跑通平台和验证错误处理，不作为模型选型依据。
              </Notice>
              <label className="form-field">
                <span>故障注入模式</span>
                <select
                  value={form.fault_mode}
                  onChange={(event) =>
                    patch(
                      "fault_mode",
                      event.target.value as ModelInput["fault_mode"],
                    )
                  }
                >
                  <option value="none">正常规则输出</option>
                  <option value="noisy">扰动输出（用于质量对比）</option>
                  <option value="timeout">模拟调用超时</option>
                  <option value="invalid_json">模拟不合规输出</option>
                  <option value="error">模拟服务错误</option>
                </select>
              </label>
            </>
          )}
          <div className="form-section-label">推理参数</div>
          <div className="form-grid form-grid-three">
            <label className="form-field">
              <span>超时（秒）</span>
              <input
                type="number"
                min={1}
                max={300}
                required
                value={form.timeout_seconds}
                onChange={(event) =>
                  patch("timeout_seconds", Number(event.target.value))
                }
              />
            </label>
            <label className="form-field">
              <span>Temperature</span>
              <input
                type="number"
                min={0}
                max={2}
                step={0.1}
                required
                value={form.temperature}
                onChange={(event) =>
                  patch("temperature", Number(event.target.value))
                }
              />
            </label>
            <label className="form-field">
              <span>最大输出 tokens</span>
              <input
                type="number"
                min={128}
                max={8192}
                required
                value={form.max_tokens}
                onChange={(event) =>
                  patch("max_tokens", Number(event.target.value))
                }
              />
            </label>
          </div>
          <CheckField
            checked={form.enabled}
            onChange={(value) => patch("enabled", value)}
          >
            启用模型，允许工单调用与评测
          </CheckField>
          {error && <ErrorState error={error} />}
        </div>
        <div className="modal-footer">
          <Button type="button" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button
            type="submit"
            variant="primary"
            busy={busy}
            icon={<Check size={16} />}
          >
            {model ? "保存配置" : "接入模型"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
