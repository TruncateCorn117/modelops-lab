import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  Braces,
  Check,
  ClipboardCopy,
  FileText,
  Play,
  RotateCcw,
  Sparkles,
  Timer,
} from "lucide-react";
import { ApiError, post, refreshData, useApi } from "../api";
import type { Inference, Model, TicketOutput } from "../types";
import {
  Button,
  Card,
  CardHeading,
  DemoBadge,
  Empty,
  ErrorState,
  Loading,
  Notice,
  PageHeader,
  useToast,
} from "../ui";
import {
  date,
  errorMessage,
  fieldLabels,
  fields,
  latency,
  number,
  outputValue,
} from "../utils";

const examples = [
  "2025-02-12，3号产线的贴标机（设备编号：LB-003）出现 E17 报警，故障现象：传感器信号间歇丢失。处理措施：重新连接传感器接线并复位。停机18分钟。",
  "2025-02-13，包装产线的输送机（设备编号：CV-012）发生异常。故障现象：传动皮带磨损打滑。处理措施：更换皮带并调整张力。停机35分钟。",
  "2025-02-14，装配产线的工控机（设备编号：IPC-008）出现 APP-502 报错。故障现象：控制软件无法加载配方。处理措施：重启应用并恢复配置。停机12分钟。",
];
export default function Playground() {
  const models = useApi<Model[]>("/api/models");
  const [modelId, setModelId] = useState("");
  const [text, setText] = useState(examples[0]);
  const [example, setExample] = useState(0);
  const [result, setResult] = useState<Inference | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [running, setRunning] = useState(false);
  const [view, setView] = useState<"fields" | "json">("fields");
  const [elapsed, setElapsed] = useState(0);
  const notify = useToast();
  const available = (models.data || []).filter((model) => model.enabled);
  useEffect(() => {
    if (
      models.data &&
      !models.data.some((model) => model.id === modelId && model.enabled)
    )
      setModelId(
        models.data.find((model) => model.is_default && model.enabled)?.id ||
          models.data.find((model) => model.enabled)?.id ||
          "",
      );
  }, [models.data, modelId]);
  const model = models.data?.find((item) => item.id === modelId);
  useEffect(() => {
    if (!running) return;
    const start = performance.now();
    const timer = setInterval(
      () => setElapsed((performance.now() - start) / 1000),
      100,
    );
    return () => clearInterval(timer);
  }, [running]);
  async function infer() {
    setRunning(true);
    setResult(null);
    setError(null);
    setElapsed(0);
    try {
      const response = await post<Inference>("/api/infer", {
        model_id: modelId,
        text: text.trim(),
      });
      setResult(response);
      refreshData();
    } catch (reason) {
      setError(reason instanceof Error ? reason : new Error(String(reason)));
      refreshData();
    } finally {
      setRunning(false);
    }
  }
  async function copy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(result.output, null, 2),
      );
      notify("结构化结果已复制。");
    } catch (error) {
      notify(errorMessage(error), true);
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="TICKET PLAYGROUND"
        title="工单体验台"
        description="输入一条工单，查看模型如何提取关键信息并判断故障类别。"
        actions={
          <a className="button button-secondary" href="#evaluations">
            前往批量评测 <ArrowUpRight size={15} />
          </a>
        }
      />
      {models.error && (
        <ErrorState error={models.error} retry={models.reload} />
      )}
      <div className="playground-grid">
        <Card className="playground-input">
          <CardHeading
            title="输入工单"
            detail="自由文本 → 标准化字段"
            action={<span className="step-badge">01 / INPUT</span>}
          />
          <div className="playground-controls">
            <label className="form-field">
              <span>选择模型服务</span>
              {models.loading ? (
                <Loading text="读取模型…" />
              ) : (
                <select
                  value={modelId}
                  onChange={(event) => setModelId(event.target.value)}
                  disabled={running}
                >
                  <option value="" disabled>
                    请选择已启用的模型
                  </option>
                  {available.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} · {item.version}
                      {item.provider === "demo" ? "（规则模拟）" : ""}
                      {item.is_default ? " · 默认" : ""}
                    </option>
                  ))}
                </select>
              )}
            </label>
            {model && (
              <div className="model-parameter-line">
                <span>
                  Temperature <strong>{model.temperature}</strong>
                </span>
                <span>
                  上限 <strong>{model.max_tokens} tokens</strong>
                </span>
                <span>
                  超时 <strong>{model.timeout_seconds}s</strong>
                </span>
              </div>
            )}
            {!models.loading && !available.length && (
              <Notice>
                还没有已启用的模型。
                <a href="#models" className="text-link">
                  前往模型中心接入服务。
                </a>
              </Notice>
            )}
            <div className="input-label-line">
              <label htmlFor="ticket-text">工单原文</label>
              <button
                className="text-link"
                disabled={running}
                onClick={() => {
                  const next = (example + 1) % examples.length;
                  setExample(next);
                  setText(examples[next]);
                }}
              >
                <RotateCcw size={13} />
                换个合成示例
              </button>
            </div>
            <textarea
              id="ticket-text"
              className="ticket-textarea"
              maxLength={8000}
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="粘贴工单文本，例如设备异常、报警信息、处理措施和停机时长…"
              disabled={running}
            />
            <div className="input-footnote">
              <span>示例为人工构造的合成工单</span>
              <span>{text.length.toLocaleString()} / 8,000</span>
            </div>
            {model?.provider === "demo" && (
              <Notice tone="warning">
                当前使用规则模拟服务，不调用真实大模型。输出和耗时仅用于验证平台流程。
              </Notice>
            )}
            <Button
              variant="primary"
              className="run-inference-button"
              busy={running}
              disabled={!modelId || !text.trim()}
              onClick={infer}
              icon={<Play size={16} fill="currentColor" />}
            >
              {running ? `正在处理 · ${elapsed.toFixed(1)}s` : "运行工单分析"}
            </Button>
            <p className="privacy-caption">
              工单原文与结果会写入本地请求日志，便于追踪和复测。
            </p>
          </div>
        </Card>
        <Card className="playground-output">
          <CardHeading
            title="处理结果"
            detail="提取 8 个字段，并完成故障分类"
            action={<span className="step-badge">02 / OUTPUT</span>}
          />
          {running ? (
            <div className="inference-loading">
              <div className="inference-orbit">
                <Braces size={32} />
                <span />
              </div>
              <h3>正在解析工单</h3>
              <p>等待模型返回，并校验结构化输出…</p>
              <span className="mono">{elapsed.toFixed(1)} s</span>
            </div>
          ) : error ? (
            <div className="output-error">
              <ErrorState error={error} />
              <p>失败请求也会记录在日志中，可以根据请求编号查看原因。</p>
              <a
                className="text-link"
                href={
                  error instanceof ApiError && error.requestId
                    ? `#requests/${error.requestId}`
                    : "#requests"
                }
              >
                查看请求日志 <ArrowUpRight size={15} />
              </a>
            </div>
          ) : result ? (
            <>
              <div className="result-meta">
                <span className="result-success">
                  <Check size={15} />
                  处理完成
                </span>
                {result.is_simulated && <DemoBadge />}
                <span className="latency-chip">
                  <Timer size={14} />
                  {latency(result.latency_ms)}
                </span>
              </div>
              <div className="result-toolbar">
                <div className="segmented">
                  <button
                    className={view === "fields" ? "selected" : ""}
                    onClick={() => setView("fields")}
                  >
                    <FileText size={14} />
                    字段视图
                  </button>
                  <button
                    className={view === "json" ? "selected" : ""}
                    onClick={() => setView("json")}
                  >
                    <Braces size={14} />
                    JSON
                  </button>
                </div>
                <button
                  className="icon-button"
                  onClick={copy}
                  aria-label="复制 JSON 结果"
                  title="复制 JSON 结果"
                >
                  <ClipboardCopy size={16} />
                </button>
              </div>
              {view === "fields" ? (
                <OutputFields output={result.output} />
              ) : (
                <pre className="json-block result-json">
                  {JSON.stringify(result.output, null, 2)}
                </pre>
              )}
              <div className="inference-result-footer">
                <div>
                  <span>请求编号</span>
                  <a className="mono text-link" href={`#requests/${result.id}`}>
                    {result.id.slice(0, 16)} <ArrowUpRight size={13} />
                  </a>
                </div>
                <div>
                  <span>Tokens（输入 / 输出）</span>
                  <strong>
                    {number(result.input_tokens)} /{" "}
                    {number(result.output_tokens)}
                  </strong>
                </div>
                <div>
                  <span>完成时间</span>
                  <strong>{date(result.created_at, true)}</strong>
                </div>
              </div>
            </>
          ) : (
            <Empty
              icon={<Sparkles size={28} />}
              title="一条工单，结构化呈现"
              description="选择模型并运行，提取设备、产线、故障代码、处理措施等字段。原文中缺失的信息保留为空。"
            />
          )}
        </Card>
      </div>
      <div className="playground-bottom">
        <span className="list-icon">
          <FlaskIcon />
        </span>
        <div>
          <strong>单条体验之后，看看模型是否稳定</strong>
          <p>用固定测试集比较字段准确率、分类表现与延迟，导出可复现报告。</p>
        </div>
        <a className="text-link" href="#evaluations">
          创建评测 <ArrowUpRight size={15} />
        </a>
      </div>
    </>
  );
}
function FlaskIcon() {
  return <Braces size={20} />;
}
export function OutputFields({ output }: { output: TicketOutput }) {
  return (
    <dl className="output-fields">
      {fields.map((key) => (
        <div
          key={key}
          className={`${key === "symptom" || key === "action_taken" ? "wide-field" : ""} ${key === "category" ? "category-field" : ""}`}
        >
          <dt>{fieldLabels[key]}</dt>
          <dd className={output[key] == null ? "null-value" : ""}>
            {outputValue(key, output[key])}
          </dd>
        </div>
      ))}
    </dl>
  );
}
