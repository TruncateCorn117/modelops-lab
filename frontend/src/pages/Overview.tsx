import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Box,
  Cpu,
  FlaskConical,
  Layers3,
  Play,
  RefreshCw,
  Server,
  TerminalSquare,
  Timer,
  TrendingUp,
} from "lucide-react";
import { useApi } from "../api";
import { usePublicDemo } from "../publicDemo";
import type { Dashboard } from "../types";
import {
  Button,
  Card,
  CardHeading,
  DemoBadge,
  Empty,
  ErrorState,
  Loading,
  PageHeader,
  StatusBadge,
} from "../ui";
import { date, latency, number, percent } from "../utils";

export default function Overview() {
  const publicDemo = usePublicDemo();
  const query = useApi<Dashboard>("/api/dashboard", 10000);
  const dashboard = query.data;
  return (
    <>
      <PageHeader
        eyebrow="WORKSPACE OVERVIEW"
        title="工作区总览"
        description="连接模型服务，理解运行表现，让每一次模型选型都有依据。"
        actions={
          <Button icon={<RefreshCw size={16} />} onClick={query.reload}>
            刷新数据
          </Button>
        }
      />
      <section className="welcome-banner">
        <div className="welcome-content">
          <span className="banner-kicker">
            <span /> MANUFACTURING AI WORKSPACE
          </span>
          <h2>
            让工单成为
            <br />
            可衡量的模型能力。
          </h2>
          <p>
            从字段提取、故障分类，到多模型对比。
            <br />
            在一个工作区内，完成接入、测试与验证。
          </p>
          <a href="#evaluations" className="button button-white">
            {publicDemo ? "查看评测报告" : "创建一次评测"}{" "}
            <ArrowUpRight size={16} />
          </a>
          <a href="#playground" className="banner-link">
            先试一条工单 <ArrowRight size={15} />
          </a>
        </div>
        <div className="pipeline-visual" aria-hidden="true">
          <div className="pipeline-grid" />
          <div className="pipeline-node node-input">
            <TerminalSquare size={19} />
            <span>原始工单</span>
            <span className="node-mini">TEXT INPUT</span>
          </div>
          <div className="pipeline-node node-engine">
            <Layers3 size={29} />
            <span>统一推理服务</span>
            <span className="node-mini">MODEL GATEWAY</span>
          </div>
          <div className="pipeline-node node-output">
            <Activity size={19} />
            <span>结构化结果</span>
            <span className="node-mini">EVALUATE & OBSERVE</span>
          </div>
          <svg viewBox="0 0 440 240" className="pipeline-lines">
            <path d="M100 120H170M285 120H346" />
            <circle cx="136" cy="120" r="3" />
            <circle cx="315" cy="120" r="3" />
          </svg>
          <span className="pipeline-footnote">
            VERSIONED · TRACEABLE · REPRODUCIBLE
          </span>
        </div>
      </section>
      {query.error && <ErrorState error={query.error} retry={query.reload} />}
      {query.loading && !dashboard && <Loading />}
      {dashboard && (
        <>
          <div className="metrics-grid">
            <Metric
              label="已注册模型"
              value={number(dashboard.models_total)}
              detail={
                <>
                  <span className="green-text">
                    {dashboard.models_healthy} 个可用
                  </span>
                  <span>已完成健康检查</span>
                </>
              }
              icon={<Box size={19} />}
            />
            <Metric
              label="累计推理请求"
              value={number(dashboard.requests_total)}
              detail={<>含体验台与批量评测请求</>}
              icon={<Activity size={19} />}
            />
            <Metric
              label="调用成功率"
              value={
                dashboard.requests_total ? percent(dashboard.success_rate) : "—"
              }
              detail={
                dashboard.requests_total ? (
                  <>请求成功 ≠ 内容正确</>
                ) : (
                  <>运行第一条工单后查看</>
                )
              }
              icon={<TrendingUp size={19} />}
            />
            <Metric
              label="P95 响应延迟"
              value={latency(dashboard.p95_latency_ms)}
              detail={<>服务调用与校验 · 含模拟与真实接口</>}
              icon={<Timer size={19} />}
            />
          </div>
          <p className="dashboard-metric-note">
            总览包含规则模拟与真实接口；模型选型请查看逐模型评测。
          </p>
          <div className="overview-main-grid">
            <Card>
              <CardHeading
                title="请求活动"
                detail="按日聚合的调用量与失败请求"
                action={
                  <span className="live-label">
                    <span />每 10 秒更新
                  </span>
                }
              />
              <ActivityChart daily={dashboard.daily} />
              <div className="chart-legend">
                <span>
                  <i className="legend-teal" />
                  全部请求
                </span>
                <span>
                  <i className="legend-red" />
                  失败请求
                </span>
                <span className="chart-caption">以服务器日期分组</span>
              </div>
            </Card>
            <Card className="resource-card">
              <CardHeading
                title="服务资源"
                detail="API 进程采样，不含外部模型进程"
                action={<Server size={18} className="muted" />}
              />
              <div className="resource-reading">
                <span className="resource-symbol">
                  <Cpu size={19} />
                </span>
                <div>
                  <span>进程 CPU</span>
                  <strong>
                    {number(dashboard.resource.process_cpu_percent, 1)}
                    <small>%</small>
                  </strong>
                </div>
              </div>
              <div className="resource-bar">
                <span
                  style={{
                    width: `${Math.min(100, dashboard.resource.process_cpu_percent)}%`,
                  }}
                />
              </div>
              <div className="resource-reading second">
                <span className="resource-symbol violet">
                  <Layers3 size={19} />
                </span>
                <div>
                  <span>进程内存</span>
                  <strong>
                    {number(dashboard.resource.process_memory_mb, 1)}
                    <small>MB</small>
                  </strong>
                </div>
              </div>
              <div className="resource-footer">
                <span>当前运行的评测</span>
                <strong>
                  {dashboard.active_runs}
                  <small> / 2</small>
                </strong>
              </div>
              <p className="sample-caption">
                采样时间 {date(dashboard.resource.sampled_at, true)}
              </p>
            </Card>
          </div>
          <div className="overview-bottom-grid">
            <Card>
              <CardHeading
                title="最近评测"
                detail={`累计 ${dashboard.runs_total} 次评测任务`}
                action={
                  <a className="text-link" href="#evaluations">
                    全部评测 <ArrowRight size={14} />
                  </a>
                }
              />
              {dashboard.recent_runs.length ? (
                <div className="recent-runs">
                  {dashboard.recent_runs.slice(0, 4).map((run) => (
                    <a
                      key={run.id}
                      className="recent-run"
                      href={`#evaluations/${run.id}`}
                    >
                      <span className="list-icon">
                        <FlaskConical size={19} />
                      </span>
                      <div>
                        <strong>{run.name}</strong>
                        <span>
                          {run.dataset_name} · {run.completed}/{run.total} 请求
                        </span>
                      </div>
                      <StatusBadge status={run.status} />
                      <ChevronArrow />
                    </a>
                  ))}
                </div>
              ) : (
                <Empty
                  icon={<FlaskConical size={25} />}
                  title="第一份评测报告，等你创建"
                  description="用同一份测试集对比模型，记录准确率与响应表现。"
                  action={
                    <a href="#evaluations" className="button button-secondary">
                      <Play size={14} />
                      开始评测
                    </a>
                  }
                />
              )}
            </Card>
            <Card>
              <CardHeading
                title="模型调用分布"
                detail="基于实际记录的调用次数"
                action={<Box size={18} className="muted" />}
              />
              {dashboard.by_model.length ? (
                <div className="model-usage">
                  {dashboard.by_model.slice(0, 5).map((model) => (
                    <div key={model.model_id}>
                      <div className="usage-label">
                        <strong>{model.model_name}</strong>
                        <span>{number(model.requests)} 次</span>
                      </div>
                      <div className="usage-track">
                        <span
                          style={{
                            width: `${Math.max(1, (model.requests / Math.max(...dashboard.by_model.map((item) => item.requests), 1)) * 100)}%`,
                          }}
                        />
                      </div>
                      <div className="usage-detail">
                        <span>成功率 {percent(model.success_rate)}</span>
                        <span>平均 {latency(model.avg_latency_ms)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty
                  icon={<Box size={25} />}
                  title="暂无调用记录"
                  description="接入模型后，先在工单体验台运行一次调用。"
                  action={
                    <a className="text-link" href="#playground">
                      打开体验台 <ArrowRight size={14} />
                    </a>
                  }
                />
              )}
            </Card>
          </div>
          <Card>
            <CardHeading
              title="最近请求"
              detail="通过请求编号追踪每一次推理"
              action={
                <a className="text-link" href="#requests">
                  查看全部 <ArrowRight size={14} />
                </a>
              }
            />
            {dashboard.recent_requests.length ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>请求编号</th>
                      <th>模型</th>
                      <th>调用状态</th>
                      <th>响应延迟</th>
                      <th>时间</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {dashboard.recent_requests.slice(0, 5).map((log) => (
                      <tr key={log.id}>
                        <td>
                          <a
                            className="mono text-link"
                            href={`#requests/${log.id}`}
                          >
                            {log.id.slice(0, 12)}
                          </a>
                        </td>
                        <td>
                          <div className="cell-flex">
                            <span>{log.model_name}</span>
                            {log.is_simulated && <DemoBadge />}
                          </div>
                        </td>
                        <td>
                          <StatusBadge status={log.status} />
                        </td>
                        <td className="numeric">{latency(log.latency_ms)}</td>
                        <td className="muted">{date(log.created_at, true)}</td>
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
            ) : (
              <div className="compact-empty">
                还没有请求。运行工单或启动评测后，调用记录会显示在这里。
              </div>
            )}
          </Card>
        </>
      )}
    </>
  );
}
function ChevronArrow() {
  return <ArrowUpRight size={15} className="muted" />;
}
function Metric({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: string;
  detail: React.ReactNode;
  icon: React.ReactNode;
}) {
  return (
    <Card className="metric-card">
      <div className="metric-top">
        <span>{label}</span>
        <span className="metric-icon">{icon}</span>
      </div>
      <strong className="metric-value">{value}</strong>
      <div className="metric-detail">{detail}</div>
    </Card>
  );
}
function ActivityChart({ daily }: { daily: Dashboard["daily"] }) {
  if (!daily.length || daily.every((day) => day.requests === 0))
    return (
      <div className="chart-empty">
        <div className="chart-empty-lines" />
        <Activity size={26} />
        <strong>等待第一条调用数据</strong>
        <p>运行推理或评测后，查看每日请求趋势。</p>
      </div>
    );
  const max = Math.max(...daily.map((day) => day.requests), 1);
  const ceiling = max <= 5 ? 5 : Math.ceil(max / 5) * 5;
  return (
    <div className="activity-chart">
      <div className="chart-axis">
        {[1, 0.75, 0.5, 0.25, 0].map((value) => (
          <span key={value}>{number(Math.round(ceiling * value))}</span>
        ))}
      </div>
      <div className="chart-plot">
        <div className="chart-grid-lines">
          {[0, 1, 2, 3, 4].map((item) => (
            <span key={item} />
          ))}
        </div>
        <div className="chart-bars">
          {daily.map((day) => (
            <div
              key={day.date}
              className="chart-bar-group"
              title={`${day.date}：${day.requests} 次请求，${day.errors} 次失败`}
            >
              <div className="chart-bar-space">
                <div
                  className="chart-bar"
                  style={{ height: `${(day.requests / ceiling) * 100}%` }}
                />
                <div
                  className="chart-error-bar"
                  style={{ height: `${(day.errors / ceiling) * 100}%` }}
                />
              </div>
              <span>{day.date.slice(5).replace("-", "/")}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
