import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Download,
  FileJson,
  FlaskConical,
  Hash,
  Play,
  Plus,
  Search,
  Square,
  Target,
  Timer,
} from "lucide-react";
import { download, post, refreshData, useApi } from "../api";
import { LocalDeploymentNotice, usePublicDemo } from "../publicDemo";
import type {
  Dataset,
  Model,
  Run,
  RunResult,
  Summary,
  TicketOutput,
} from "../types";
import {
  Button,
  Card,
  CardHeading,
  CheckField,
  DemoBadge,
  Empty,
  ErrorState,
  Loading,
  Modal,
  Notice,
  PageHeader,
  Pagination,
  StatusBadge,
  useToast,
} from "../ui";
import {
  categoryLabels,
  date,
  errorMessage,
  fieldLabels,
  fields,
  isActive,
  latency,
  number,
  outputValue,
  percent,
} from "../utils";

function selectedRunId() {
  return window.location.hash.split("/")[1] || "";
}
export default function Evaluations() {
  const publicDemo = usePublicDemo();
  const query = useApi<Run[]>("/api/runs", 3000);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState(selectedRunId);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const listener = () => setSelected(selectedRunId());
    window.addEventListener("hashchange", listener);
    return () => window.removeEventListener("hashchange", listener);
  }, []);
  const runs = (query.data || []).filter(
    (run) =>
      run.name.toLowerCase().includes(search.toLowerCase()) &&
      (filter === "all" ||
        (filter === "active" ? isActive(run.status) : run.status === filter)),
  );
  return (
    <>
      {selected ? (
        <RunDetail id={selected} />
      ) : (
        <>
          <PageHeader
            eyebrow="EVALUATION LAB"
            title="评测实验室"
            description="在同一份工单数据上比较模型，用可复现的结果支持选型。"
            actions={
              <Button
                variant="primary"
                icon={<Plus size={17} />}
                onClick={() => setCreating(true)}
                disabled={publicDemo}
                title={publicDemo ? "请本地部署完整版本" : undefined}
              >
                新建评测
              </Button>
            }
          />
          <LocalDeploymentNotice />
          <div className="evaluation-intro">
            <div className="eval-intro-icon">
              <FlaskConical size={26} />
            </div>
            <div>
              <h2>同一任务，同一标准，清晰比较。</h2>
              <p>
                固定数据划分与提示词版本，记录每次评测的配置快照，检查质量、稳定性与延迟。
              </p>
            </div>
            <div className="eval-intro-pills">
              <span>
                <Target size={14} />
                字段提取
              </span>
              <span>
                <BarChart3 size={14} />
                故障分类
              </span>
              <span>
                <Timer size={14} />
                服务表现
              </span>
            </div>
          </div>
          <Card>
            <div className="table-toolbar">
              <div className="segmented">
                {[
                  { id: "all", label: "全部评测" },
                  { id: "active", label: "运行中" },
                  { id: "completed", label: "已完成" },
                ].map((item) => (
                  <button
                    key={item.id}
                    className={item.id === filter ? "selected" : ""}
                    onClick={() => setFilter(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <div className="search-input">
                <Search size={16} />
                <input
                  placeholder="搜索评测名称…"
                  aria-label="搜索评测"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
            </div>
            {query.error && (
              <ErrorState error={query.error} retry={query.reload} />
            )}
            {query.loading ? (
              <Loading text="读取评测任务…" />
            ) : !runs.length ? (
              <Empty
                icon={<FlaskConical size={28} />}
                title={
                  query.data?.length ? "没有匹配的评测" : "从第一组模型对比开始"
                }
                description={
                  query.data?.length
                    ? "尝试其他搜索词或状态筛选。"
                    : "选择数据集与候选模型，平台将逐条运行、计算指标并生成报告。"
                }
                action={
                  !query.data?.length && (
                    <Button
                      variant="primary"
                      icon={<Play size={15} />}
                      onClick={() => setCreating(true)}
                      disabled={publicDemo}
                    >
                      创建首次评测
                    </Button>
                  )
                }
              />
            ) : (
              <div className="table-scroll">
                <table className="runs-table">
                  <thead>
                    <tr>
                      <th>评测任务</th>
                      <th>数据集 / 模型</th>
                      <th>状态与进度</th>
                      <th>字段准确率</th>
                      <th>创建时间</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((run) => (
                      <tr key={run.id}>
                        <td>
                          <a
                            className="run-name"
                            href={`#evaluations/${run.id}`}
                          >
                            <span className="list-icon">
                              <FlaskConical size={17} />
                            </span>
                            <span>
                              <strong>{run.name}</strong>
                              <small className="mono">
                                {run.id.slice(0, 12)}
                              </small>
                            </span>
                          </a>
                        </td>
                        <td>
                          <span className="cell-main">{run.dataset_name}</span>
                          <span className="cell-sub">
                            {run.model_names?.join(" / ") ||
                              `${run.model_ids.length} 个模型`}
                          </span>
                        </td>
                        <td>
                          <StatusBadge status={run.status} />
                          <div className="inline-progress">
                            <span>
                              <i
                                style={{
                                  width: `${run.total ? (run.completed / run.total) * 100 : 0}%`,
                                }}
                              />
                            </span>
                            <small>
                              {run.completed}/{run.total}
                            </small>
                          </div>
                        </td>
                        <td className="numeric">
                          {run.summary
                            ? percent(run.summary.field_accuracy)
                            : "—"}
                        </td>
                        <td className="muted nowrap">
                          {date(run.created_at, true)}
                        </td>
                        <td>
                          <a
                            className="icon-button"
                            href={`#evaluations/${run.id}`}
                            aria-label={`查看 ${run.name}`}
                          >
                            <ChevronRight size={18} />
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="table-bottom-note">
              <Clock3 size={14} />
              <span>运行进度每 3 秒自动刷新 · 同时最多运行 2 个任务</span>
              <span>{runs.length} 个任务</span>
            </div>
          </Card>
        </>
      )}
      {creating && !publicDemo && (
        <CreateRun
          onClose={() => setCreating(false)}
          onCreated={(run) => {
            setCreating(false);
            window.location.hash = `evaluations/${run.id}`;
            refreshData();
          }}
        />
      )}
    </>
  );
}
function CreateRun({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (run: Run) => void;
}) {
  const modelsQuery = useApi<Model[]>("/api/models");
  const datasetsQuery = useApi<Dataset[]>("/api/datasets");
  const [name, setName] = useState(
    `工单模型对比 · ${new Date().toLocaleDateString("zh-CN")}`,
  );
  const [datasetId, setDatasetId] = useState("");
  const [modelIds, setModelIds] = useState<string[]>([]);
  const [split, setSplit] = useState("test");
  const [maxSamples, setMaxSamples] = useState(30);
  const [concurrency, setConcurrency] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    if (datasetsQuery.data?.length && !datasetId)
      setDatasetId(datasetsQuery.data[0].id);
  }, [datasetsQuery.data, datasetId]);
  const available = (modelsQuery.data || []).filter((model) => model.enabled);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onCreated(
        await post<Run>("/api/runs", {
          name: name.trim(),
          dataset_id: datasetId,
          model_ids: modelIds,
          split,
          max_samples: maxSamples,
          concurrency,
        }),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason : new Error(String(reason)));
      setBusy(false);
    }
  }
  return (
    <Modal
      title="创建模型评测"
      description="模型配置、数据指纹与提示词版本将在创建时固定。"
      onClose={() => {
        if (!busy) onClose();
      }}
      wide
    >
      <form onSubmit={submit}>
        <div className="modal-body form-stack">
          <label className="form-field">
            <span>
              评测名称 <b>*</b>
            </span>
            <input
              required
              maxLength={120}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          {modelsQuery.error && (
            <ErrorState error={modelsQuery.error} retry={modelsQuery.reload} />
          )}
          {datasetsQuery.error && (
            <ErrorState
              error={datasetsQuery.error}
              retry={datasetsQuery.reload}
            />
          )}
          <label className="form-field">
            <span>
              数据集 <b>*</b>
            </span>
            <select
              required
              value={datasetId}
              onChange={(event) => setDatasetId(event.target.value)}
            >
              <option value="" disabled>
                请选择数据集
              </option>
              {datasetsQuery.data?.map((dataset) => (
                <option key={dataset.id} value={dataset.id}>
                  {dataset.name} · {dataset.count} 条 ·{" "}
                  {dataset.source === "synthetic" ? "合成数据" : "用户数据"}
                </option>
              ))}
            </select>
          </label>
          <div className="form-field">
            <span>
              候选模型 <b>*</b>
              <span className="optional">可多选，用于横向对比</span>
            </span>
            {modelsQuery.loading ? (
              <Loading text="加载模型…" />
            ) : available.length ? (
              <div className="model-select-list">
                {available.map((model) => (
                  <div
                    key={model.id}
                    className={modelIds.includes(model.id) ? "checked" : ""}
                  >
                    <CheckField
                      checked={modelIds.includes(model.id)}
                      onChange={(checked) =>
                        setModelIds((ids) =>
                          checked
                            ? [...ids, model.id]
                            : ids.filter((id) => id !== model.id),
                        )
                      }
                    >
                      <strong>{model.name}</strong>
                      <small>
                        {model.model_name} · {model.version}
                      </small>
                    </CheckField>
                    {model.provider === "demo" && <DemoBadge />}
                  </div>
                ))}
              </div>
            ) : (
              <Notice>请先在模型中心接入并启用一个模型。</Notice>
            )}
          </div>
          <div className="form-grid form-grid-three">
            <label className="form-field">
              <span>数据划分</span>
              <select
                value={split}
                onChange={(event) => setSplit(event.target.value)}
              >
                <option value="test">测试集 · test</option>
                <option value="dev">开发集 · dev</option>
                <option value="all">全部数据 · all</option>
              </select>
            </label>
            <label className="form-field">
              <span>每个模型最多样本数</span>
              <input
                type="number"
                required
                min={1}
                max={1000}
                value={maxSamples}
                onChange={(event) => setMaxSamples(Number(event.target.value))}
              />
            </label>
            <label className="form-field">
              <span>并发请求数</span>
              <input
                type="number"
                required
                min={1}
                max={8}
                value={concurrency}
                onChange={(event) => setConcurrency(Number(event.target.value))}
              />
            </label>
          </div>
          <Notice>
            实际样本数取所选划分与上限的较小值。建议使用开发集调试，保留测试集用于最终验证；无自动重试。
          </Notice>
          {available.some(
            (model) => modelIds.includes(model.id) && model.provider === "demo",
          ) && (
            <Notice tone="warning">
              已选择规则模拟服务。报告将明确标注模拟结果，不能将其解读为真实大模型性能。
            </Notice>
          )}
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
            disabled={!modelIds.length || !datasetId || !name.trim()}
            icon={<Play size={15} />}
          >
            开始评测
          </Button>
        </div>
      </form>
    </Modal>
  );
}
function RunDetail({ id }: { id: string }) {
  const publicDemo = usePublicDemo();
  const query = useApi<Run>(`/api/runs/${encodeURIComponent(id)}`, 2500);
  const run = query.data;
  const resultsQuery = useApi<RunResult[]>(
    `/api/runs/${encodeURIComponent(id)}/results`,
    run && isActive(run.status) ? 4000 : 0,
  );
  const [downloadBusy, setDownloadBusy] = useState("");
  const [cancelBusy, setCancelBusy] = useState(false);
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [selectedResult, setSelectedResult] = useState<RunResult | null>(null);
  const [modelFilter, setModelFilter] = useState("all");
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [matrixModel, setMatrixModel] = useState("");
  const notify = useToast();
  useEffect(() => {
    setPage(1);
  }, [modelFilter, errorsOnly, id]);
  useEffect(() => {
    if (run && !isActive(run.status)) resultsQuery.reload();
  }, [run?.status]); // Fetch final results after the last progress poll.
  const results = useMemo(
    () =>
      (resultsQuery.data || []).filter(
        (result) =>
          (modelFilter === "all" || result.model_id === modelFilter) &&
          (!errorsOnly ||
            result.status !== "success" ||
            result.score.field_accuracy < 1 ||
            !result.score.category_correct),
      ),
    [resultsQuery.data, modelFilter, errorsOnly],
  );
  const rows = results.slice((page - 1) * 12, page * 12);
  async function exportReport(format: "markdown" | "json" | "csv") {
    setDownloadBusy(format);
    try {
      await download(
        `/api/runs/${encodeURIComponent(id)}/report?format=${format}`,
        `modelops-report-${id.slice(0, 8)}.${format === "markdown" ? "md" : format}`,
      );
      notify("评测报告已下载。");
    } catch (error) {
      notify(errorMessage(error), true);
    } finally {
      setDownloadBusy("");
    }
  }
  async function cancel() {
    if (publicDemo) return;
    setCancelBusy(true);
    try {
      await post(`/api/runs/${encodeURIComponent(id)}/cancel`);
      refreshData();
      notify("已请求取消，已完成的评测结果会保留。");
    } catch (error) {
      notify(errorMessage(error), true);
    } finally {
      setCancelBusy(false);
    }
  }
  return (
    <>
      <a className="back-link" href="#evaluations">
        <ArrowLeft size={15} />
        全部评测
      </a>
      {query.error && <ErrorState error={query.error} retry={query.reload} />}
      {!run && query.loading && <Loading text="加载评测详情…" />}
      {run && (
        <>
          <PageHeader
            eyebrow="EVALUATION REPORT"
            title={run.name}
            description={`${run.dataset_name} · ${run.model_ids.length} 个候选模型 · 创建于 ${date(run.created_at)}`}
            actions={
              <>
                {isActive(run.status) && (
                  <Button
                    variant="danger"
                    onClick={cancel}
                    disabled={publicDemo}
                    title={publicDemo ? "请本地部署完整版本" : undefined}
                    busy={cancelBusy}
                    icon={<Square size={14} />}
                  >
                    停止评测
                  </Button>
                )}
                <Button
                  icon={<FileJson size={15} />}
                  onClick={() => setShowSnapshots(true)}
                >
                  配置快照
                </Button>
                <Button
                  variant="primary"
                  icon={<Download size={16} />}
                  busy={downloadBusy === "markdown"}
                  disabled={Boolean(downloadBusy) || isActive(run.status)}
                  onClick={() => exportReport("markdown")}
                >
                  导出报告
                </Button>
              </>
            }
          />
          <Card className="run-progress-card">
            <div className="run-progress-label">
              <div>
                <StatusBadge status={run.status} />
                <strong>
                  {run.completed} <span>/ {run.total} 请求已完成</span>
                </strong>
              </div>
              <span>
                {run.total ? Math.round((run.completed / run.total) * 100) : 0}%
              </span>
            </div>
            <div className="run-progress-track">
              <span
                style={{
                  width: `${run.total ? (run.completed / run.total) * 100 : 0}%`,
                }}
              />
            </div>
            <div className="run-config-summary">
              <span>
                划分 <strong>{run.split}</strong>
              </span>
              <span>
                并发 <strong>{run.concurrency}</strong>
              </span>
              <span>
                提示词 <strong>{run.prompt_version}</strong>
              </span>
              <span>
                数据指纹{" "}
                <code title={run.dataset_sha256}>
                  {run.dataset_sha256?.slice(0, 12)}
                </code>
              </span>
              <span>
                {isActive(run.status)
                  ? "每 2.5 秒更新进度"
                  : `结束于 ${date(run.finished_at, true)}`}
              </span>
            </div>
            {run.error && <p className="red-text">{run.error}</p>}
          </Card>
          {run.model_snapshots?.some((model) => model.provider === "demo") && (
            <Notice tone="warning">
              本次评测包含规则模拟服务，其质量与延迟用于验证平台流程，不代表真实
              LLM 能力。模型对比表已分别标记。
            </Notice>
          )}
          {run.summary && (
            <>
              <div className="metrics-grid run-metrics">
                {[
                  {
                    label: "字段准确率",
                    value: percent(run.summary.field_accuracy),
                    detail: "8 个提取字段的标准化精确匹配",
                    icon: <Target size={18} />,
                  },
                  {
                    label: "分类准确率",
                    value: percent(run.summary.category_accuracy),
                    detail: `Macro-F1 ${percent(run.summary.macro_f1)} · 固定四类`,
                    icon: <BarChart3 size={18} />,
                  },
                  {
                    label: "调用成功率",
                    value: percent(run.summary.success_rate),
                    detail: `${run.summary.successful} 次成功 · ${run.summary.failed} 次失败`,
                    icon: <CheckCircle2 size={18} />,
                  },
                  {
                    label: "P95 响应延迟",
                    value: latency(run.summary.p95_latency_ms),
                    detail: "仅成功请求 · 服务调用与校验",
                    icon: <Timer size={18} />,
                  },
                ].map((metric) => (
                  <Card className="metric-card" key={metric.label}>
                    <div className="metric-top">
                      <span>{metric.label}</span>
                      <span className="metric-icon">{metric.icon}</span>
                    </div>
                    <strong className="metric-value">{metric.value}</strong>
                    <div className="metric-detail">{metric.detail}</div>
                  </Card>
                ))}
              </div>
            </>
          )}
          {run.by_model?.length > 0 && (
            <Card>
              <CardHeading
                title="模型表现对比"
                detail="质量指标按全部已完成样本计算，失败请求按零分计入"
                action={
                  <span className="badge badge-gray">
                    {run.by_model.length} 个模型
                  </span>
                }
              />
              <div className="table-scroll">
                <table className="comparison-table">
                  <thead>
                    <tr>
                      <th>模型</th>
                      <th>字段准确率</th>
                      <th>分类准确率</th>
                      <th>Macro-F1</th>
                      <th>成功率</th>
                      <th>P50 / P95</th>
                      <th>吞吐量</th>
                    </tr>
                  </thead>
                  <tbody>
                    {run.by_model.map((summary) => (
                      <tr key={summary.model_id}>
                        <td>
                          <strong>{summary.model_name}</strong>
                          <div className="comparison-model-label">
                            {summary.is_simulated ? (
                              <DemoBadge />
                            ) : (
                              <span className="badge badge-teal">真实推理</span>
                            )}
                          </div>
                        </td>
                        <td>
                          <div className="score-cell">
                            <strong>{percent(summary.field_accuracy)}</strong>
                            <span>
                              <i
                                style={{
                                  width: `${summary.field_accuracy * 100}%`,
                                }}
                              />
                            </span>
                          </div>
                        </td>
                        <td className="numeric">
                          {percent(summary.category_accuracy)}
                        </td>
                        <td className="numeric">{percent(summary.macro_f1)}</td>
                        <td className="numeric">
                          {percent(summary.success_rate)}
                        </td>
                        <td className="numeric nowrap">
                          {latency(summary.p50_latency_ms)}
                          <span className="muted"> / </span>
                          {latency(summary.p95_latency_ms)}
                        </td>
                        <td className="numeric">
                          {number(summary.throughput_rps, 2)}{" "}
                          <small>req/s</small>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="table-bottom-note">
                <Hash size={14} />
                <span>
                  含空值字段匹配；Macro-F1
                  固定使用机械、电气、软件、其他四类。吞吐量按完成请求数 /
                  评测窗口秒数计算。
                </span>
              </div>
            </Card>
          )}
          {run.by_model?.length > 0 && (
            <div className="evaluation-analysis-grid">
              <Card>
                <CardHeading
                  title="分类混淆矩阵"
                  detail="行：标准类别 · 列：模型预测类别"
                  action={
                    <select
                      className="small-select"
                      aria-label="选择混淆矩阵模型"
                      value={matrixModel || run.by_model[0].model_id}
                      onChange={(event) => setMatrixModel(event.target.value)}
                    >
                      {run.by_model.map((model) => (
                        <option key={model.model_id} value={model.model_id}>
                          {model.model_name}
                        </option>
                      ))}
                    </select>
                  }
                />
                <ConfusionMatrix
                  summary={
                    run.by_model.find(
                      (model) => model.model_id === matrixModel,
                    ) || run.by_model[0]
                  }
                />
              </Card>
              <Card>
                <CardHeading
                  title="错误分布"
                  detail="服务调用与输出校验失败，不含内容预测错误"
                />
                {run.summary && Object.keys(run.summary.errors || {}).length ? (
                  <div className="error-distribution">
                    {Object.entries(run.summary.errors).map(([code, count]) => (
                      <div key={code}>
                        <div>
                          <span className="error-code-dot" />
                          <strong>{code}</strong>
                          <span>{count} 次</span>
                        </div>
                        <div className="error-distribution-track">
                          <span
                            style={{
                              width: `${(count / Math.max(run.summary!.failed, 1)) * 100}%`,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="no-errors">
                    <CheckCircle2 size={29} />
                    <strong>暂无调用错误</strong>
                    <p>内容是否正确，请结合逐条结果与质量指标判断。</p>
                  </div>
                )}
              </Card>
            </div>
          )}
          <Card>
            <CardHeading
              title="逐条结果"
              detail="检查原始工单、标准答案与模型输出，定位具体差异"
            />
            <div className="table-toolbar results-toolbar">
              <div className="filter-group">
                <select
                  aria-label="筛选评测结果模型"
                  value={modelFilter}
                  onChange={(event) => setModelFilter(event.target.value)}
                >
                  <option value="all">全部模型</option>
                  {run.model_ids.map((modelId, index) => (
                    <option key={modelId} value={modelId}>
                      {run.model_names[index] || modelId}
                    </option>
                  ))}
                </select>
                <CheckField checked={errorsOnly} onChange={setErrorsOnly}>
                  仅显示错误或差异
                </CheckField>
              </div>
              {!isActive(run.status) && (
                <div className="inline-actions">
                  <Button
                    icon={<Download size={14} />}
                    busy={downloadBusy === "json"}
                    disabled={Boolean(downloadBusy)}
                    onClick={() => exportReport("json")}
                  >
                    JSON
                  </Button>
                  <Button
                    icon={<Download size={14} />}
                    busy={downloadBusy === "csv"}
                    disabled={Boolean(downloadBusy)}
                    onClick={() => exportReport("csv")}
                  >
                    CSV
                  </Button>
                </div>
              )}
            </div>
            {resultsQuery.error && (
              <ErrorState
                error={resultsQuery.error}
                retry={resultsQuery.reload}
              />
            )}
            {resultsQuery.loading ? (
              <Loading text="加载逐条结果…" />
            ) : rows.length ? (
              <>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>工单文本</th>
                        <th>模型</th>
                        <th>调用状态</th>
                        <th>字段匹配</th>
                        <th>分类</th>
                        <th>耗时</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((result) => (
                        <tr key={result.id}>
                          <td>
                            <button
                              className="text-cell-button"
                              onClick={() => setSelectedResult(result)}
                            >
                              {result.text}
                            </button>
                          </td>
                          <td>{result.model_name}</td>
                          <td>
                            <StatusBadge status={result.status} />
                          </td>
                          <td>
                            <span
                              className={
                                result.score.fields_correct ===
                                result.score.fields_total
                                  ? "green-text numeric"
                                  : "numeric"
                              }
                            >
                              {result.score.fields_correct} /{" "}
                              {result.score.fields_total}
                            </span>
                          </td>
                          <td>
                            <span
                              className={
                                result.score.category_correct
                                  ? "green-text"
                                  : "red-text"
                              }
                            >
                              {result.score.category_correct ? "正确" : "错误"}
                            </span>
                          </td>
                          <td className="numeric nowrap">
                            {latency(result.latency_ms)}
                          </td>
                          <td>
                            <button
                              className="icon-button"
                              onClick={() => setSelectedResult(result)}
                              aria-label="对比工单结果"
                            >
                              <ChevronRight size={17} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pagination
                  page={page}
                  size={12}
                  count={results.length}
                  onChange={setPage}
                />
              </>
            ) : (
              <Empty
                title={
                  isActive(run.status) ? "等待首批结果" : "没有符合条件的结果"
                }
                description={
                  isActive(run.status)
                    ? "任务正在执行，结果会自动显示。"
                    : "调整模型或差异筛选，查看其他结果。"
                }
              />
            )}
          </Card>
          {showSnapshots && (
            <Modal
              title="评测配置快照"
              description="创建评测时冻结的配置，后续模型配置变更不会修改本次快照。"
              wide
              onClose={() => setShowSnapshots(false)}
            >
              <div className="modal-body">
                <div className="snapshot-summary">
                  <span>数据指纹 SHA-256</span>
                  <code>{run.dataset_sha256}</code>
                  <span>提示词版本</span>
                  <code>{run.prompt_version}</code>
                </div>
                <pre className="json-block">
                  {JSON.stringify(
                    {
                      concurrency: run.concurrency,
                      max_samples: run.max_samples,
                      split: run.split,
                      models: run.model_snapshots,
                    },
                    null,
                    2,
                  )}
                </pre>
              </div>
              <div className="modal-footer">
                <Button onClick={() => setShowSnapshots(false)}>关闭</Button>
              </div>
            </Modal>
          )}
          {selectedResult && (
            <ResultDetail
              result={selectedResult}
              onClose={() => setSelectedResult(null)}
            />
          )}
        </>
      )}
    </>
  );
}
function ConfusionMatrix({ summary }: { summary: Summary }) {
  const labels = Object.keys(categoryLabels);
  const matrix = summary.confusion_matrix || {};
  const max = Math.max(
    ...Object.values(matrix).flatMap((row) => Object.values(row)),
    1,
  );
  const label = (key: string) =>
    categoryLabels[key as keyof typeof categoryLabels];
  return (
    <div className="matrix-wrap">
      <table className="matrix-table">
        <thead>
          <tr>
            <th>实际 / 预测</th>
            {labels.map((key) => (
              <th key={key}>{label(key)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {labels.map((actual) => (
            <tr key={actual}>
              <th>{label(actual)}</th>
              {labels.map((predicted) => {
                const value = matrix[actual]?.[predicted] || 0;
                return (
                  <td key={predicted}>
                    <span
                      className={
                        actual === predicted ? "matrix-match" : "matrix-miss"
                      }
                      style={{
                        backgroundColor:
                          actual === predicted
                            ? `rgba(15, 143, 119, ${value ? 0.08 + (value / max) * 0.28 : 0.025})`
                            : `rgba(224, 114, 66, ${value ? 0.08 + (value / max) * 0.25 : 0.025})`,
                      }}
                    >
                      {value}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p>只显示四类有效预测；调用失败会影响质量指标，但不显示为类别。</p>
    </div>
  );
}
function ResultDetail({
  result,
  onClose,
}: {
  result: RunResult;
  onClose: () => void;
}) {
  function matches(key: keyof TicketOutput) {
    return key === "category"
      ? result.score.category_correct
      : result.score.field_matches[key];
  }
  return (
    <Modal
      title="逐字段对比"
      description={`${result.model_name} · ${latency(result.latency_ms)} · ${result.id}`}
      onClose={onClose}
      wide
    >
      <div className="modal-body">
        <div className="source-text">
          <span>原始工单</span>
          <p>{result.text}</p>
        </div>
        {result.status === "error" && (
          <Notice tone="warning">
            {result.error_code}：{result.error_message}
          </Notice>
        )}
        <div className="table-scroll">
          <table className="field-comparison">
            <thead>
              <tr>
                <th>字段</th>
                <th>标准答案</th>
                <th>模型输出</th>
              </tr>
            </thead>
            <tbody>
              {fields.map((key) => (
                <tr key={key} className={matches(key) ? "" : "field-mismatch"}>
                  <th>{fieldLabels[key]}</th>
                  <td>{outputValue(key, result.expected[key])}</td>
                  <td>
                    <span>
                      {result.output
                        ? outputValue(key, result.output[key])
                        : "无有效输出"}
                    </span>
                    {matches(key) && (
                      <CheckCircle2 size={13} className="green-text" />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="subtle-text">
          着色行表示差异。采用忽略大小写与空白的精确匹配；失败请求所有字段按零分计。
        </p>
      </div>
      <div className="modal-footer">
        <Button onClick={onClose}>关闭</Button>
      </div>
    </Modal>
  );
}
