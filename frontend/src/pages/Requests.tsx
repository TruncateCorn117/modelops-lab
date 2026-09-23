import { useEffect, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  ClipboardCopy,
  Clock3,
  FileText,
  RefreshCw,
  Search,
} from "lucide-react";
import { useApi } from "../api";
import type { Model, RequestDetail, RequestLog } from "../types";
import {
  Button,
  Card,
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
import { date, errorMessage, latency, number } from "../utils";
import { OutputFields } from "./Playground";

function selectedRequestId() {
  return window.location.hash.split("/")[1] || "";
}
export default function Requests() {
  const models = useApi<Model[]>("/api/models");
  const [modelId, setModelId] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(selectedRequestId);
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({
    limit: "100",
    ...(modelId ? { model_id: modelId } : {}),
    ...(status ? { status } : {}),
  });
  const query = useApi<RequestLog[]>(
    `/api/requests?${params.toString()}`,
    10000,
  );
  useEffect(() => {
    const listener = () => setSelected(selectedRequestId());
    window.addEventListener("hashchange", listener);
    return () => window.removeEventListener("hashchange", listener);
  }, []);
  useEffect(() => setPage(1), [modelId, status, search]);
  const logs = (query.data || []).filter((log) =>
    `${log.id} ${log.model_name} ${log.error_code || ""}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <>
      <PageHeader
        eyebrow="REQUEST OBSERVABILITY"
        title="请求日志"
        description="从一次请求出发，追踪输入、输出、耗时与失败原因。"
        actions={
          <Button icon={<RefreshCw size={16} />} onClick={query.reload}>
            刷新日志
          </Button>
        }
      />
      <Notice>
        日志保留工单原文和结构化结果，不保存上游原始响应或密钥。演示与真实模型调用分别标记，可通过请求编号关联评测。
      </Notice>
      <Card>
        <div className="table-toolbar">
          <div className="filter-group">
            <select
              aria-label="筛选请求模型"
              value={modelId}
              onChange={(event) => setModelId(event.target.value)}
            >
              <option value="">全部模型</option>
              {models.data?.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </select>
            <select
              aria-label="筛选请求状态"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="">全部状态</option>
              <option value="success">调用成功</option>
              <option value="error">调用失败</option>
            </select>
          </div>
          <div className="search-input">
            <Search size={16} />
            <input
              aria-label="搜索请求编号或错误"
              placeholder="搜索请求编号、模型、错误…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </div>
        {query.error && <ErrorState error={query.error} retry={query.reload} />}
        {query.loading ? (
          <Loading text="读取请求记录…" />
        ) : !logs.length ? (
          <Empty
            icon={<Activity size={28} />}
            title={
              modelId || status || search
                ? "没有匹配的请求"
                : "请求记录即将从这里开始"
            }
            description={
              modelId || status || search
                ? "调整筛选条件，查看其他调用。"
                : "在工单体验台运行一次分析，或创建批量评测，日志将自动记录。"
            }
            action={
              !modelId &&
              !status &&
              !search && (
                <a className="button button-secondary" href="#playground">
                  打开工单体验台 <ArrowUpRight size={14} />
                </a>
              )
            }
          />
        ) : (
          <>
            <div className="table-scroll">
              <table className="request-table">
                <thead>
                  <tr>
                    <th>请求编号</th>
                    <th>模型服务</th>
                    <th>状态</th>
                    <th>响应延迟</th>
                    <th>来源</th>
                    <th>时间</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {logs.slice((page - 1) * 15, page * 15).map((log) => (
                    <tr key={log.id}>
                      <td>
                        <a
                          className="mono text-link"
                          href={`#requests/${log.id}`}
                        >
                          {log.id.slice(0, 12)}
                        </a>
                        {log.error_code && (
                          <span className="cell-sub red-text">
                            {log.error_code}
                          </span>
                        )}
                      </td>
                      <td>
                        <span className="cell-main">{log.model_name}</span>
                        {log.is_simulated ? (
                          <DemoBadge />
                        ) : (
                          <span className="cell-sub">真实推理</span>
                        )}
                      </td>
                      <td>
                        <StatusBadge status={log.status} />
                      </td>
                      <td className="numeric">{latency(log.latency_ms)}</td>
                      <td>
                        {log.run_id ? (
                          <a
                            className="text-link"
                            href={`#evaluations/${log.run_id}`}
                          >
                            批量评测 <ArrowUpRight size={12} />
                          </a>
                        ) : (
                          <span className="muted">单次调用</span>
                        )}
                      </td>
                      <td className="nowrap muted">
                        {date(log.created_at, true)}
                      </td>
                      <td>
                        <a
                          href={`#requests/${log.id}`}
                          className="icon-button"
                          aria-label="查看请求详情"
                        >
                          <ArrowUpRight size={16} />
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={page}
              count={logs.length}
              size={15}
              onChange={setPage}
            />
          </>
        )}
        <div className="table-bottom-note">
          <Clock3 size={14} />
          <span>显示所选条件下最近 100 条请求 · 每 10 秒刷新</span>
        </div>
      </Card>
      {selected && (
        <RequestInspector
          id={selected}
          onClose={() => {
            window.location.hash = "requests";
          }}
        />
      )}
    </>
  );
}
function RequestInspector({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}) {
  const query = useApi<RequestDetail>(
    `/api/requests/${encodeURIComponent(id)}`,
  );
  const log = query.data;
  const notify = useToast();
  async function copy() {
    try {
      await navigator.clipboard.writeText(id);
      notify("请求编号已复制。");
    } catch (error) {
      notify(errorMessage(error), true);
    }
  }
  return (
    <Modal
      title="请求详情"
      description="定位一次模型调用的完整上下文。"
      wide
      onClose={onClose}
    >
      <div className="modal-body">
        {query.error && <ErrorState error={query.error} retry={query.reload} />}
        {query.loading && <Loading text="加载请求详情…" />}
        {log && (
          <>
            <div className="request-detail-id">
              <code>{log.id}</code>
              <button
                className="icon-button"
                onClick={copy}
                aria-label="复制请求编号"
              >
                <ClipboardCopy size={15} />
              </button>
            </div>
            <div className="request-detail-status">
              <StatusBadge status={log.status} />
              {log.is_simulated && <DemoBadge />}
              <span>{log.model_name}</span>
            </div>
            <div className="request-detail-metrics">
              <div>
                <span>响应延迟</span>
                <strong>{latency(log.latency_ms)}</strong>
              </div>
              <div>
                <span>输入 / 输出 Tokens</span>
                <strong>
                  {number(log.input_tokens)} / {number(log.output_tokens)}
                </strong>
              </div>
              <div>
                <span>请求时间</span>
                <strong>{date(log.created_at)}</strong>
              </div>
            </div>
            {log.error_code && (
              <Notice tone="warning">
                <strong>{log.error_code}</strong>
                <p>{log.error_message}</p>
              </Notice>
            )}
            <div className="source-text">
              <span>
                <FileText size={14} />
                工单原文
              </span>
              <p>{log.text}</p>
            </div>
            {log.output ? (
              <div className="request-output">
                <h3>结构化输出</h3>
                <OutputFields output={log.output} />
              </div>
            ) : (
              <div className="compact-empty">
                本次调用没有有效的结构化输出。
              </div>
            )}
            {log.run_id && (
              <a className="text-link" href={`#evaluations/${log.run_id}`}>
                查看关联评测 <ArrowUpRight size={14} />
              </a>
            )}
          </>
        )}
      </div>
      <div className="modal-footer">
        <Button onClick={onClose}>关闭详情</Button>
      </div>
    </Modal>
  );
}
