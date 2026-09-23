import { useState } from "react";
import {
  Braces,
  ChevronRight,
  Database,
  Download,
  FileJson,
  FileUp,
  Fingerprint,
  Search,
  Upload,
  X,
} from "lucide-react";
import { download, post, refreshData, useApi } from "../api";
import type { Dataset, DatasetDetail, DatasetRow } from "../types";
import {
  Button,
  Card,
  Empty,
  ErrorState,
  Loading,
  Modal,
  Notice,
  PageHeader,
  Pagination,
  useToast,
} from "../ui";
import { date, errorMessage, number } from "../utils";
import { OutputFields } from "./Playground";

const importExample = {
  name: "自定义工单测试集",
  description: "人工核对的合成示例",
  source: "synthetic",
  rows: [
    {
      id: "ticket-001",
      text: "2025-02-12，3号产线贴标机（LB-003）报警 E17，传感器信号丢失。重新连接接线，停机18分钟。",
      split: "test",
      expected: {
        equipment_id: "LB-003",
        equipment: "贴标机",
        production_line: "3号产线",
        reported_at: "2025-02-12",
        fault_code: "E17",
        category: "electrical",
        symptom: "传感器信号丢失",
        action_taken: "重新连接接线",
        downtime_minutes: 18,
      },
    },
  ],
};
export default function Datasets() {
  const query = useApi<Dataset[]>("/api/datasets");
  const [importing, setImporting] = useState(false);
  const [selected, setSelected] = useState<Dataset | null>(null);
  const [search, setSearch] = useState("");
  const [exporting, setExporting] = useState("");
  const notify = useToast();
  const datasets = (query.data || []).filter((dataset) =>
    `${dataset.name} ${dataset.description}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  async function exportDataset(dataset: Dataset) {
    setExporting(dataset.id);
    try {
      await download(
        `/api/datasets/${encodeURIComponent(dataset.id)}/export`,
        `dataset-${dataset.id}.json`,
      );
      notify("数据集已导出，可直接重新导入。");
    } catch (error) {
      notify(errorMessage(error), true);
    } finally {
      setExporting("");
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="DATASETS"
        title="数据集"
        description="管理工单文本与标准答案，用固定测试集比较模型的真实差异。"
        actions={
          <Button
            variant="primary"
            icon={<Upload size={16} />}
            onClick={() => setImporting(true)}
          >
            导入数据集
          </Button>
        }
      />
      <div className="dataset-summary">
        <div>
          <Database size={22} />
          <span>
            <strong>{query.data?.length || 0}</strong> 个数据集
          </span>
        </div>
        <div>
          <Braces size={22} />
          <span>
            <strong>
              {number(
                query.data?.reduce((sum, dataset) => sum + dataset.count, 0) ||
                  0,
              )}
            </strong>{" "}
            条标注工单
          </span>
        </div>
        <div>
          <Fingerprint size={22} />
          <span>
            内容指纹 <strong>SHA-256</strong>
          </span>
        </div>
      </div>
      <Notice>
        内置数据均为合成工单，包含开发集和测试集。导入时需提供完整标准答案，缺失信息标为
        null；同一工单不应跨划分重复出现。
      </Notice>
      <Card>
        <div className="table-toolbar">
          <div>
            <h2 className="toolbar-title">工单数据集</h2>
            <span className="muted small">
              导入后不可变更，更新数据请创建新版本
            </span>
          </div>
          <div className="search-input">
            <Search size={16} />
            <input
              placeholder="搜索数据集…"
              aria-label="搜索数据集"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </div>
        {query.error && <ErrorState error={query.error} retry={query.reload} />}
        {query.loading ? (
          <Loading text="加载数据集…" />
        ) : !datasets.length ? (
          <Empty
            icon={<Database size={27} />}
            title={
              query.data?.length
                ? "没有匹配的数据集"
                : "准备一份可重复验证的数据"
            }
            description={
              query.data?.length
                ? "调整搜索词后重试。"
                : "导入包含工单原文、标准答案与数据划分的 JSON 文件。"
            }
            action={
              !query.data?.length && (
                <Button
                  variant="primary"
                  icon={<Upload size={15} />}
                  onClick={() => setImporting(true)}
                >
                  导入数据集
                </Button>
              )
            }
          />
        ) : (
          <div className="dataset-list">
            {datasets.map((dataset) => (
              <div className="dataset-row" key={dataset.id}>
                <span className="dataset-symbol">
                  <Database size={25} />
                </span>
                <div className="dataset-identity">
                  <div className="dataset-title">
                    <button onClick={() => setSelected(dataset)}>
                      {dataset.name}
                    </button>
                    <span
                      className={`badge ${dataset.source === "synthetic" ? "badge-amber" : "badge-blue"}`}
                    >
                      {dataset.source === "synthetic" ? "合成数据" : "用户导入"}
                    </span>
                  </div>
                  <p>{dataset.description || "未提供描述"}</p>
                  <div className="dataset-details">
                    <span>{number(dataset.count)} 条工单</span>
                    <i />
                    <span>版本 {dataset.revision}</span>
                    <i />
                    <code title={dataset.sha256}>
                      {dataset.sha256.slice(0, 12)}
                    </code>
                    <i />
                    <span>{date(dataset.created_at, true)}</span>
                  </div>
                </div>
                <div className="dataset-actions">
                  <Button
                    icon={<Download size={14} />}
                    busy={exporting === dataset.id}
                    disabled={Boolean(exporting)}
                    onClick={() => exportDataset(dataset)}
                  >
                    导出
                  </Button>
                  <Button onClick={() => setSelected(dataset)}>
                    查看数据 <ChevronRight size={15} />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
      <div className="dataset-guidelines">
        <div>
          <span>01</span>
          <strong>标准答案可核对</strong>
          <p>每个提取字段都来自原文，避免补充未出现的信息。</p>
        </div>
        <div>
          <span>02</span>
          <strong>开发与测试分开</strong>
          <p>使用 dev 调整提示词，使用 test 验证最终效果。</p>
        </div>
        <div>
          <span>03</span>
          <strong>固定数据，保留版本</strong>
          <p>每次评测记录内容指纹，让对比结果能够复现。</p>
        </div>
      </div>
      {importing && (
        <ImportDataset
          onClose={() => setImporting(false)}
          onImported={(dataset) => {
            setImporting(false);
            setSelected(dataset);
            refreshData();
          }}
        />
      )}
      {selected && (
        <DatasetPreview
          dataset={selected}
          onClose={() => setSelected(null)}
          onExport={() => exportDataset(selected)}
          exporting={exporting === selected.id}
        />
      )}
    </>
  );
}
function ImportDataset({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: (dataset: Dataset) => void;
}) {
  const [json, setJson] = useState("");
  const [name, setName] = useState("");
  const [filename, setFilename] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [showExample, setShowExample] = useState(false);
  const notify = useToast();
  async function loadFile(file?: File) {
    if (!file) return;
    setError(null);
    if (file.size > 10 * 1024 * 1024) {
      setError(new Error("文件不可超过 10 MB。数据集最多 1,000 条工单。"));
      return;
    }
    try {
      setJson(await file.text());
      setFilename(file.name);
    } catch (reason) {
      setError(reason instanceof Error ? reason : new Error(String(reason)));
    }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(json);
      } catch {
        throw new Error("JSON 格式不正确，请检查引号、逗号和括号。");
      }
      if (!payload || typeof payload !== "object" || Array.isArray(payload))
        throw new Error(
          "需要包含 name、description、source 和 rows 的 JSON 对象。",
        );
      if (!Array.isArray(payload.rows) || !payload.rows.length)
        throw new Error(
          "rows 需要是非空数组，每条工单需包含 text、expected 和 split。",
        );
      const dataset = await post<Dataset>("/api/datasets", {
        name: name.trim() || payload.name,
        description: payload.description || "",
        source: payload.source || "user",
        rows: payload.rows,
      });
      notify(`已导入 ${dataset.count} 条工单。`);
      onImported(dataset);
    } catch (reason) {
      setError(reason instanceof Error ? reason : new Error(String(reason)));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="导入工单数据集"
      description="上传 JSON 文件，或粘贴符合数据结构的内容。"
      wide
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form onSubmit={submit}>
        <div className="modal-body form-stack">
          <label
            className="file-dropzone"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              void loadFile(event.dataTransfer.files[0]);
            }}
          >
            <FileUp size={28} />
            <strong>{filename || "选择 JSON 文件，或拖放到这里"}</strong>
            <span>最多 1,000 条工单 · 文件不超过 10 MB</span>
            <input
              type="file"
              accept=".json,application/json"
              disabled={busy}
              onChange={(event) => loadFile(event.target.files?.[0])}
            />
          </label>
          <label className="form-field">
            <span>
              数据集名称{" "}
              <span className="optional">选填，覆盖文件中的名称</span>
            </span>
            <input
              maxLength={120}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="使用 JSON 中的 name 字段"
            />
          </label>
          <div className="input-label-line">
            <label htmlFor="dataset-json">JSON 内容</label>
            <button
              type="button"
              className="text-link"
              onClick={() => setShowExample(!showExample)}
            >
              {showExample ? "收起格式示例" : "查看格式示例"}{" "}
              <FileJson size={14} />
            </button>
          </div>
          {showExample && (
            <div className="import-example">
              <pre className="json-block">
                {JSON.stringify(importExample, null, 2)}
              </pre>
              <button
                type="button"
                className="text-link"
                onClick={() => {
                  setJson(JSON.stringify(importExample, null, 2));
                  setFilename("");
                  setShowExample(false);
                }}
              >
                填入示例（会替换编辑区）
              </button>
            </div>
          )}
          <textarea
            className="json-textarea"
            id="dataset-json"
            value={json}
            onChange={(event) => setJson(event.target.value)}
            placeholder={
              '{ "name": "工单测试集", "source": "user", "rows": [...] }'
            }
            required
            spellCheck={false}
          />
          <Notice>
            expected 必须包含全部 9 个输出字段。category 取 mechanical /
            electrical / software / other；其余字段缺失时使用 null。split 取 dev
            或 test。
          </Notice>
          {error && <ErrorState error={error} />}
        </div>
        <div className="modal-footer">
          <Button type="button" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button
            type="submit"
            variant="primary"
            icon={<Upload size={15} />}
            busy={busy}
            disabled={!json.trim()}
          >
            校验并导入
          </Button>
        </div>
      </form>
    </Modal>
  );
}
function DatasetPreview({
  dataset,
  onClose,
  onExport,
  exporting,
}: {
  dataset: Dataset;
  onClose: () => void;
  onExport: () => void;
  exporting: boolean;
}) {
  const query = useApi<DatasetDetail>(
    `/api/datasets/${encodeURIComponent(dataset.id)}`,
  );
  const [split, setSplit] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<DatasetRow | null>(null);
  const rows = (query.data?.rows || []).filter(
    (row) =>
      (split === "all" || row.split === split) &&
      `${row.id} ${row.text}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <Modal
      title={dataset.name}
      description={`${dataset.count} 条工单 · 版本 ${dataset.revision} · ${dataset.source === "synthetic" ? "合成数据" : "用户导入"}`}
      wide
      onClose={onClose}
    >
      <div className="modal-body dataset-preview-body">
        <div className="dataset-fingerprint">
          <Fingerprint size={15} />
          <code title={dataset.sha256}>{dataset.sha256}</code>
        </div>
        {query.error && <ErrorState error={query.error} retry={query.reload} />}
        {query.loading ? (
          <Loading text="加载工单样本…" />
        ) : (
          <>
            <div className="table-toolbar preview-toolbar">
              <select
                aria-label="筛选数据划分"
                value={split}
                onChange={(event) => {
                  setSplit(event.target.value);
                  setPage(1);
                }}
              >
                <option value="all">全部划分</option>
                <option value="dev">
                  开发集 ·{" "}
                  {query.data?.rows.filter((row) => row.split === "dev")
                    .length || 0}
                </option>
                <option value="test">
                  测试集 ·{" "}
                  {query.data?.rows.filter((row) => row.split === "test")
                    .length || 0}
                </option>
              </select>
              <div className="search-input">
                <Search size={15} />
                <input
                  placeholder="搜索工单…"
                  aria-label="搜索工单样本"
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setPage(1);
                  }}
                />
              </div>
            </div>
            {rows.length ? (
              <>
                <div className="table-scroll">
                  <table className="dataset-preview-table">
                    <thead>
                      <tr>
                        <th>样本编号</th>
                        <th>工单原文</th>
                        <th>划分</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.slice((page - 1) * 8, page * 8).map((row) => (
                        <tr
                          key={row.id}
                          className={
                            selected?.id === row.id ? "selected-row" : ""
                          }
                        >
                          <td className="mono">{row.id}</td>
                          <td>
                            <button
                              className="text-cell-button"
                              onClick={() => setSelected(row)}
                            >
                              {row.text}
                            </button>
                          </td>
                          <td>
                            <span
                              className={`badge ${row.split === "test" ? "badge-blue" : "badge-gray"}`}
                            >
                              {row.split}
                            </span>
                          </td>
                          <td>
                            <button
                              className="icon-button"
                              onClick={() => setSelected(row)}
                              aria-label={`查看 ${row.id} 标准答案`}
                            >
                              <ChevronRight size={16} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pagination
                  page={page}
                  count={rows.length}
                  size={8}
                  onChange={setPage}
                />
              </>
            ) : (
              <Empty
                title="没有匹配的工单"
                description="调整划分或搜索词后重试。"
              />
            )}
            {selected && (
              <div className="dataset-row-inspector">
                <div className="inspector-heading">
                  <strong>{selected.id} · 标准答案</strong>
                  <button
                    className="icon-button"
                    onClick={() => setSelected(null)}
                    aria-label="收起标准答案"
                  >
                    <X size={16} />
                  </button>
                </div>
                <p className="inspector-text">{selected.text}</p>
                <OutputFields output={selected.expected} />
              </div>
            )}
          </>
        )}
      </div>
      <div className="modal-footer">
        <Button
          icon={<Download size={15} />}
          onClick={onExport}
          busy={exporting}
        >
          导出 JSON
        </Button>
        <Button onClick={onClose}>关闭</Button>
      </div>
    </Modal>
  );
}
